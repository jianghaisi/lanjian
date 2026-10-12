import { BaseTexture, CanvasResource, Geometry, ImageResource, Mesh, RenderTexture, SCALE_MODES, Shader, Texture, type Renderer } from 'pixi.js'
import registration from '../../../assets/visuals/pet-sequences/registration.json'
import type { PetAnimation } from './pet-action-motion'
import { isolatePetFrame } from './pet-frame-isolation'
import { petFrameDensity, type PetRegistration } from './pet-sequence-registration'

const urls = import.meta.glob('../../../assets/visuals/pet-sequences/*.png', { eager: true, import: 'default', query: '?url' }) as Record<string, string>
const flows = import.meta.glob('../../../assets/visuals/pet-sequences/*.flow', { eager: true, import: 'default', query: '?url' }) as Record<string, string>
type Registration = PetRegistration
export type PetSheet = { texture: Texture; flow: Texture; registration: Registration }
export type PetPose = { sheet: PetSheet; index: number }

export async function loadPetSheet(intent: PetAnimation): Promise<PetSheet> {
  const metadata = (registration as Record<string, Registration>)[intent]
  if (!metadata) throw new Error('PET_SEQUENCE_UNAVAILABLE')
  const pages = metadata.pages ?? [{ file: `${intent}.png`, origin: [0, 0] }]
  const pageUrls = pages.map(page => urls[`../../../assets/visuals/pet-sequences/${page.file}`])
  if (pageUrls.some(url => !url)) throw new Error('PET_SEQUENCE_UNAVAILABLE')
  // Private resources: destroying a preview cannot invalidate the other host.
  const resources = pageUrls.map(url => new ImageResource(url!, { autoLoad: false }))
  try {
    const flowUrl = flows[`../../../assets/visuals/pet-sequences/${intent}.flow`]
    if (!flowUrl) throw new Error('PET_MOTION_UNAVAILABLE')
    // Wait for every page even on failure, so none can complete after disposal.
    const [motionResult, pageResult] = await Promise.allSettled([fetch(flowUrl), Promise.allSettled(resources.map(resource => resource.load()))] as const)
    if (motionResult.status !== 'fulfilled') throw new Error('PET_MOTION_UNAVAILABLE')
    if (pageResult.status !== 'fulfilled' || pageResult.value.some(result => result.status === 'rejected')) throw new Error('PET_SEQUENCE_UNAVAILABLE')
    const response = motionResult.value
    if (!response.ok) throw new Error('PET_MOTION_UNAVAILABLE')
    const bytes = new Uint8Array(await response.arrayBuffer())
    const motionHeight = 32 * metadata.frames.length * 2
    if (bytes.length !== 32 * motionHeight * 4) throw new Error('PET_MOTION_INVALID')
    const canvas = document.createElement('canvas')
    canvas.width = metadata.size[0]!; canvas.height = metadata.size[1]!
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('PET_FRAME_UNAVAILABLE')
    // Native pixel copy into this host's texture; original atlas files remain
    // separate and untouched. Never resize pages or individual body parts.
    resources.forEach((resource, index) => context.drawImage(resource.source, pages[index]!.origin[0]!, pages[index]!.origin[1]!))
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    for (const frame of metadata.frames) {
      isolatePetFrame(pixels.data, canvas.width, frame.rect)
      // Yield between cells so an uncached action cannot freeze the old pose/UI
      // for an entire atlas pass. No processing runs in the animation ticker.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    context.putImageData(pixels, 0, 0)
    const flow = Texture.fromBuffer(bytes, 32, motionHeight, { scaleMode: SCALE_MODES.LINEAR })
    return { texture: new Texture(new BaseTexture(new CanvasResource(canvas), { scaleMode: SCALE_MODES.LINEAR })), flow, registration: metadata }
  } finally { resources.forEach(resource => resource.destroy()) }
}

const vertex = `precision mediump float;
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 point;
void main(){point=aVertexPosition;gl_Position=vec4((projectionMatrix*translationMatrix*vec3(point,1.0)).xy,0.0,1.0);}`
const fragment = `precision mediump float;
varying vec2 point;
uniform sampler2D imageA; uniform sampler2D imageB;
uniform vec4 rectA; uniform vec4 rectB;
uniform vec2 anchorA; uniform vec2 anchorB;
uniform vec2 sizeA; uniform vec2 sizeB;
uniform float densityA; uniform float densityB; uniform float blend;
uniform sampler2D motion; uniform float motionRow; uniform float motionRows; uniform float warp;
vec2 displacement(float row){
  vec2 p=clamp(point/512.0,vec2(0.5/32.0),vec2(31.5/32.0));
  return texture2D(motion,vec2(p.x,(row+p.y)/motionRows)).rg*255.0-128.0;
}
vec4 sampleFrame(sampler2D img,vec4 rect,vec2 anchor,vec2 size,float density,vec2 position){
  vec2 p=(position-vec2(256.0,486.0))*density+anchor;
  if(p.x<0.5||p.y<0.5||p.x>rect.z-0.5||p.y>rect.w-0.5)return vec4(0.0);
  return texture2D(img,(rect.xy+p)/size);
}
void main(){
  vec2 a=point-displacement(motionRow)*blend*warp;
  vec2 b=point-displacement(motionRow+1.0)*(1.0-blend)*warp;
  vec4 colorA=sampleFrame(imageA,rectA,anchorA,sizeA,densityA,a);
  vec4 colorB=sampleFrame(imageB,rectB,anchorB,sizeB,densityB,b);
  // Unmatched hands/hair have no reliable correspondence, including between
  // actions. Keep one pose's contour and its original soft alpha; only blend
  // pixels that agree. A whole-pose crossfade creates two translucent figures.
  float disagreement=max(length(colorA.rgb-colorB.rgb),abs(colorA.a-colorB.a)*3.0);
  float confidence=1.0-smoothstep(0.06,0.22,disagreement);
  float weight=mix(step(0.5,blend),blend,confidence);
  gl_FragColor=mix(colorA,colorB,weight);
}`

/** Blend premultiplied RGBA in one pass, so overlapping frames don't turn translucent. */
export function createPetSequenceMesh() {
  const geometry = new Geometry().addAttribute('aVertexPosition', [0,0,512,0,512,512,0,512], 2).addIndex([0,1,2,0,2,3])
  const shader = Shader.from(vertex, fragment, {
    imageA: Texture.EMPTY, imageB: Texture.EMPTY, rectA: [0,0,1,1], rectB: [0,0,1,1],
    anchorA: [0,0], anchorB: [0,0], sizeA: [1,1], sizeB: [1,1], densityA: 1, densityB: 1, blend: 0,
    motion: Texture.EMPTY, motionRow: 0, motionRows: 2, warp: 0
  })
  const mesh = new Mesh(geometry, shader)
  function set(a: PetPose, b: PetPose, mix: number) {
    for (const [suffix, pose] of [['A', a], ['B', b]] as const) {
      const meta = pose.sheet.registration, frame = meta.frames[pose.index]
      shader.uniforms[`image${suffix}`] = pose.sheet.texture
      shader.uniforms[`rect${suffix}`] = frame.rect
      shader.uniforms[`anchor${suffix}`] = frame.anchor
      shader.uniforms[`size${suffix}`] = meta.size
      shader.uniforms[`density${suffix}`] = petFrameDensity(meta, pose.index)
    }
    shader.uniforms.blend = mix
    shader.uniforms.motion = a.sheet.flow
    shader.uniforms.motionRow = a.index * 2
    shader.uniforms.motionRows = a.sheet.registration.frames.length * 2
    shader.uniforms.warp = a.sheet === b.sheet && b.index === (a.index+1)%a.sheet.registration.frames.length ? 1 : 0
  }
  function capture(renderer: Renderer): PetPose {
    // Capture the composed pose, including an interrupted transition. An integer
    // source frame would visibly step backwards from the displayed interpolation.
    // Keep the current renderer's pixel density through an interruption. A
    // default 1x snapshot softens hair/eyes before the next action starts.
    // Registration remains in the same 512-unit character coordinates.
    const texture = RenderTexture.create({ width: 512, height: 512, resolution: renderer.resolution, scaleMode: SCALE_MODES.LINEAR })
    const snapshot = new Mesh(geometry, shader)
    try { renderer.render(snapshot, { renderTexture: texture, clear: true }) }
    catch (error) { texture.destroy(true); throw error }
    finally { snapshot.destroy() }
    return { index: 0, sheet: { texture, flow: Texture.EMPTY, registration: {
      size: [512, 512], density: 1, frames: [{ rect: [0, 0, 512, 512], anchor: [256, 486] }]
    } } }
  }
  return { mesh, set, capture }
}
