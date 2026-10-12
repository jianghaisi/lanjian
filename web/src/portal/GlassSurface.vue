<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ src: string; paused?: boolean; intensity?: number; goldShards?: boolean; liquidGrowth?: boolean; growthStage?: 'idle' | 'growing' | 'complete'; priority?: 'high' | 'low' | 'auto' }>(), { paused: false, intensity: 1, goldShards: false, liquidGrowth: false, growthStage: 'complete', priority: 'auto' })
const emit = defineEmits<{ ready: []; error: [] }>()
const host = ref<HTMLElement>(), picture = ref<HTMLImageElement>(), canvas = ref<HTMLCanvasElement>()
const active = ref(false)
let dispose = () => {}, notified = false, started = false
function loaded() { if (!notified) { notified = true; emit('ready') }; initialize() }
function failed() { emit('error') }

const vertexSource = `attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}`
const fragmentSource = `precision mediump float;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_intensity;
uniform float u_gold_shards;
uniform float u_liquid_growth;
uniform float u_growth_progress;
varying vec2 v_uv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=v_uv;
  vec4 base=texture2D(u_image,uv);
  if(base.a<0.01){gl_FragColor=vec4(0.0);return;}
  // The source alpha confines every filament and particle to the glass body.
  float time=u_time;
  float flow=sin(uv.y*18.0+uv.x*9.0-time*0.8);
  vec2 offset=vec2(flow,sin(uv.x*21.0+time*0.6))*0.0009*u_intensity;
  vec3 refracted=texture2D(u_image,clamp(uv+offset,0.0,1.0)).rgb;
  float threads=0.0;
  for(int i=0;i<8;i++){
    float k=float(i);
    float centre=0.12+k*0.11+0.026*sin(uv.y*11.0+time*0.2+k*1.7);
    float pulse=pow(0.5+0.5*sin(uv.y*26.0-time*1.4+k*1.6),3.0);
    threads+=exp(-abs(uv.x-centre)*440.0)*pulse;
  }
  vec2 field=uv*vec2(88.0,140.0);
  field.x+=sin(uv.y*10.0-time*0.25)*0.7;
  field.y-=time*0.5;
  vec2 cell=floor(field), local=fract(field)-0.5;
  float seed=hash(cell);
  float particle=(1.0-smoothstep(0.01,0.11,length(local)))*step(0.945,seed);
  particle*=0.3+0.7*pow(0.5+0.5*sin(time*1.6+seed*35.0),2.0);
  // Larger, sparser facets remain readable at the portrait's actual display size.
  // Opt-in keeps the approved welcome arms' material unchanged.
  float facets=0.0;
  if(u_gold_shards>0.5){
    vec2 drift=uv*vec2(30.0,46.0);
    drift.x+=sin(uv.y*9.0-time*0.3)*0.55;
    drift.y-=time*0.85;
    vec2 tile=floor(drift), p=fract(drift)-0.5;
    float id=hash(tile);
    float angle=id*6.28318+time*(0.22+id*0.3);
    float c=cos(angle), s=sin(angle);
    p=mat2(c,-s,s,c)*p;
    p.x/=0.5+0.5*abs(sin(time*0.7+id*18.0));
    float edge=abs(p.x)*1.2+abs(p.y)*0.8;
    float shape=1.0-smoothstep(0.18,0.26,edge);
    float glint=0.25+0.75*pow(0.5+0.5*sin(time*1.8+id*25.0),4.0);
    facets=shape*step(0.78,id)*glint*mix(0.48,1.0,step(0.0,p.x+p.y*0.4));
    particle*=0.45;
  }
  float sweep=pow(max(0.0,cos(uv.y*8.0+uv.x*3.0-time*0.36)),18.0);
  vec3 light=vec3(1.0,0.48,0.13)*(threads*1.3+particle*2.5)+vec3(1.0,0.72,0.3)*facets*1.8+vec3(0.85,0.94,1.0)*sweep*0.22;
  vec3 colour=mix(base.rgb*0.74,refracted,0.35)+light*u_intensity*smoothstep(0.2,0.75,base.a);
  if(u_liquid_growth>0.5){
    // Moving implicit streams merge into a sheet. A derivative-free normal
    // produces chrome highlights without textures, meshes or extra assets.
    float cycle=mod(time,16.0);
    float reach=smoothstep(0.0,7.0,cycle);
    float release=1.0-smoothstep(12.0,16.0,cycle);
    float liquid=0.0;
    float rim=0.0;
    float slope=0.0;
    for(int i=0;i<5;i++){
      float k=float(i);
      float wave=uv.y*11.0+k*1.9-time*0.32;
      float centre=0.17+k*0.16+sin(wave)*0.045+sin(uv.y*23.0+k)*0.012;
      float width=0.019+0.016*sin(uv.y*7.0+k*2.0-time*0.22);
      float d=abs(uv.x-centre);
      float tip=reach-(0.11+0.10*sin(k*2.7));
      float alive=1.0-smoothstep(tip-0.10,tip+0.03,uv.y);
      float sheet=(1.0-smoothstep(width*0.45,width,d))*alive;
      liquid=max(liquid,sheet);
      rim=max(rim,exp(-abs(d-width*0.70)*210.0)*alive);
      slope+=sin((uv.x-centre)/max(width,0.009)*2.1)*sheet;
    }
    liquid*=release;
    rim*=release;
    vec2 bend=vec2(0.0);
    vec3 glass=texture2D(u_image,clamp(uv+bend,0.0,1.0)).rgb;
    float reflection=pow(0.5+0.5*sin(slope*3.7+uv.y*9.0-time*0.65),9.0);
    vec3 chrome=mix(vec3(0.10,0.13,0.15),vec3(0.78,0.84,0.89),reflection);
    chrome+=vec3(1.0,0.66,0.25)*rim*0.6;
    float metal=0.5+0.5*sin(uv.y*5.0+uv.x*7.0-time*0.16);
    vec3 material=mix(glass*0.82+vec3(0.73,0.86,0.92)*rim*0.3,chrome,metal*0.62);
    colour=mix(colour,material,liquid*0.68*u_intensity);
    colour+=vec3(0.93,0.75,0.49)*rim*0.24;
  }
  float progress=u_growth_progress;
  float alpha=base.a;
  if(progress<0.999){
    // Each branching front advances at its own rate, then the thin streams
    // coalesce into the complete body. This changes visible geometry/alpha.
    float branch=sin(uv.x*22.0+sin(uv.y*13.0)*1.5)*0.045;
    float distanceFromSeed=(0.98-uv.y)+abs(uv.x-0.5)*0.22+branch;
    float reach=progress*1.28-0.09;
    float front=reach-distanceFromSeed;
    float joined=smoothstep(-0.012,0.10,front);
    float ribs=pow(0.5+0.5*sin(uv.x*69.0+sin(uv.y*19.0)*2.5),6.0);
    float tendrils=smoothstep(-0.07,0.025,front)*ribs;
    float born=max(joined,tendrils*0.85)*smoothstep(0.0,0.08,progress);
    float edge=exp(-abs(front)*65.0)*born;
    vec3 silver=vec3(0.76,0.84,0.91)+vec3(0.22,0.10,0.02)*sin(uv.y*32.0+time);
    colour=mix(colour,silver,edge*0.8)+vec3(1.0,0.59,0.18)*edge*0.6;
    alpha*=born;
  }
  gl_FragColor=vec4(colour,alpha);
}`

function initialize() {
  if (started || !canvas.value || !host.value || !picture.value?.complete || !picture.value.naturalWidth) return
  started = true
  const el = canvas.value, image = picture.value, root = host.value
  const gl = el.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' })
  if (!gl) return
  const shaders: WebGLShader[] = []
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) { shaders.forEach(shader => gl.deleteShader(shader)); if (program) gl.deleteProgram(program); return }
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader)); return }
  gl.useProgram(program)
  const buffer = gl.createBuffer(), texture = gl.createTexture()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
  const attribute = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)
  gl.uniform1f(gl.getUniformLocation(program, 'u_gold_shards'), props.goldShards ? 1 : 0)
  gl.uniform1f(gl.getUniformLocation(program, 'u_liquid_growth'), props.liquidGrowth ? 1 : 0)
  const clock = gl.getUniformLocation(program, 'u_time'), intensity = gl.getUniformLocation(program, 'u_intensity')
  const growthUniform = gl.getUniformLocation(program, 'u_growth_progress')
  let growth = props.growthStage === 'complete' ? 1 : 0
  let frame = 0, time = 0, last = performance.now(), visible = true, lost = false
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const draw = (now: number) => {
    frame = 0
    if (lost || !visible || document.hidden) return
    if (!props.paused && !motion.matches) {
      const delta = Math.min(now - last, 100) / 1000
      time += delta
      if (props.growthStage === 'growing') growth = Math.min(1, growth + delta / 4)
    }
    if (props.growthStage === 'complete' || motion.matches) growth = 1
    gl.uniform1f(growthUniform, growth)
    el.dataset.growth = growth.toFixed(3)
    last = now
    gl.uniform1f(clock, time); gl.uniform1f(intensity, props.intensity)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6)
    active.value = true
    if (!props.paused && !motion.matches) frame = requestAnimationFrame(draw)
  }
  const resume = () => { if (!frame && visible && !document.hidden && !lost) { last = performance.now(); frame = requestAnimationFrame(draw) } }
  const visibility = () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0 }; resume() }
  const resize = new ResizeObserver(() => {
    const scale = Math.min(devicePixelRatio, 1.25), width = root.clientWidth, height = root.clientHeight
    el.width = Math.max(1, Math.min(1300, Math.round(width * scale)))
    el.height = Math.max(1, Math.min(1900, Math.round(height * scale)))
    gl.viewport(0, 0, el.width, el.height); resume()
  })
  const observer = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; if (!visible && frame) { cancelAnimationFrame(frame); frame = 0 }; resume() })
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; active.value = false; if (frame) cancelAnimationFrame(frame); frame = 0 }
  resize.observe(root); observer.observe(root)
  document.addEventListener('visibilitychange', visibility)
  motion.addEventListener('change', resume)
  el.addEventListener('webglcontextlost', contextLost)
  const unwatch = watch(() => props.paused, resume)
  const unwatchGrowth = watch(() => props.growthStage, stage => { growth = stage === 'complete' ? 1 : 0; resume() })
  dispose = () => {
    unwatch(); unwatchGrowth(); if (frame) cancelAnimationFrame(frame)
    resize.disconnect(); observer.disconnect()
    document.removeEventListener('visibilitychange', visibility); motion.removeEventListener('change', resume)
    el.removeEventListener('webglcontextlost', contextLost)
    gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader))
  }
}
onMounted(() => { if (picture.value?.complete && picture.value.naturalWidth) loaded() })
onBeforeUnmount(() => dispose())
</script>

<template><div ref="host" class="glass-surface" :data-renderer="active ? 'webgl' : 'image'" aria-hidden="true"><img ref="picture" :src="src" alt="" decoding="async" :fetchpriority="priority" :class="{ 'gpu-ready': active }" @load="loaded" @error="failed" /><canvas ref="canvas" :class="{ 'gpu-ready': active }"></canvas></div></template>
<style scoped>
.glass-surface{position:relative;line-height:0}.glass-surface>img{width:100%;height:auto;display:block}.glass-surface>img.gpu-ready{visibility:hidden}.glass-surface>canvas{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none}.glass-surface>canvas.gpu-ready{opacity:1}
</style>
