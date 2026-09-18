<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as PIXI from 'pixi.js'
import type { CompanionState } from '../services/companion-controller'
import { intersection, type DialogueRect } from '../services/companion-dialogue-placement'

const props = withDefaults(defineProps<{
  state?: CompanionState
  blink?: boolean
  gazeX?: number
  gazeY?: number
  intensity?: number
  action?: number
}>(), { state: 'idle', blink: false, gazeX: 0, gazeY: 0, intensity: .45, action: 0 })

const stage = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const loading = ref(true)
const failed = ref(false)
let app: PIXI.Application | undefined
let model: import('pixi-live2d-display/cubism4').Live2DModel | undefined
let observer: ResizeObserver | undefined
let disposed = false
let corePromise: Promise<void> | undefined

declare global {
  interface Window { PIXI?: typeof PIXI; Live2DCubismCore?: unknown }
}

function publicAsset(path: string) {
  return new URL(path.replace(/^\//, ''), document.baseURI).href
}

function loadCubismCore() {
  if (window.Live2DCubismCore) return Promise.resolve()
  if (corePromise) return corePromise
  corePromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-live2d-core]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Cubism Core 加载失败')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = publicAsset('vendor/live2d/live2dcubismcore.min.js')
    script.dataset.live2dCore = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Cubism Core 加载失败'))
    document.head.append(script)
  })
  return corePromise
}

function layout() {
  if (!app || !model || !stage.value) return
  const width = Math.max(1, stage.value.clientWidth)
  const height = Math.max(1, stage.value.clientHeight)
  app.renderer.resize(width, height)
  const sourceWidth = model.internalModel.width || 1024
  const sourceHeight = model.internalModel.height || 1024
  const fit = Math.min(width / sourceWidth, height / sourceHeight)
  model.scale.set(fit * 1.08)
  model.anchor.set(.5, .5)
  model.position.set(width * .5, height * .51)
}

// Only measured on layout/dialogue changes, never by copying the GPU framebuffer.
function getProtectionRects(clip?: DialogueRect): DialogueRect[] {
  if (!model || !canvas.value || !stage.value || loading.value) return []
  const rect = canvas.value.getBoundingClientRect()
  const internal = model.internalModel
  const rects: DialogueRect[] = []
  const sx = rect.width / Math.max(1, stage.value.clientWidth)
  const sy = rect.height / Math.max(1, stage.value.clientHeight)
  for (let index = 0; index < internal.coreModel.getDrawableCount(); index++) {
    if (internal.coreModel.getDrawableOpacity(index) <= 0) continue
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    const vertices = internal.getDrawableVertices(index)
    for (let i = 0; i < vertices.length; i += 2) {
      const local = internal.localTransform.apply(new PIXI.Point(vertices[i], vertices[i + 1]))
      const point = model.toGlobal(local)
      left = Math.min(left, point.x); right = Math.max(right, point.x)
      top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
    }
    if (![left, top, right, bottom].every(Number.isFinite)) continue
    const bounds = { left: rect.left + left * sx, top: rect.top + top * sy, right: rect.left + right * sx, bottom: rect.top + bottom * sy }
    const visible = clip ? intersection(bounds, clip) : bounds
    if (visible) rects.push(visible)
  }
  return rects
}
defineExpose({ getProtectionRects })

async function play(group: 'Blink' | 'Nod' | 'Shake') {
  if (!model) return
  try { await model.motion(group, 0, 3) } catch { /* Keep idle animation alive if one optional motion fails. */ }
}

async function create() {
  if (!stage.value || !canvas.value) return
  try {
    await loadCubismCore()
    if (disposed) return
    window.PIXI = PIXI
    const { Live2DModel } = await import('pixi-live2d-display/cubism4')
    Live2DModel.registerTicker(PIXI.Ticker)
    app = new PIXI.Application({
      view: canvas.value,
      width: Math.max(1, stage.value.clientWidth),
      height: Math.max(1, stage.value.clientHeight),
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      // The source rig is a 4K atlas but its face occupies a relatively small
      // region. Keep at least 2x backing pixels so the library close-up does not
      // become needlessly soft on 100% Windows scaling.
      resolution: Math.min(3, Math.max(2, window.devicePixelRatio || 1))
    })
    model = await Live2DModel.from(publicAsset('live2d/lanjian-rig/lanjian-rig.model3.json'), { autoInteract: false })
    if (disposed) { model.destroy(); return }
    app.stage.addChild(model)
    layout()
    // This PSD2Live rig exaggerates its angle parameters. Start from the authored
    // neutral pose; tracking is opt-in through a non-zero intensity below.
    observer = new ResizeObserver(layout)
    observer.observe(stage.value)
    loading.value = false
  } catch (error) {
    console.error('Live2D companion failed to load', error)
    loading.value = false
    failed.value = true
  }
}

watch(() => [props.gazeX, props.gazeY, props.intensity], () => {
  const amount = Math.max(0, Math.min(1, props.intensity))
  if (amount <= 0) return
  model?.focus(Math.max(-1, Math.min(1, props.gazeX / 2.2)) * amount, Math.max(-1, Math.min(1, -props.gazeY / 1.5)) * amount)
})
watch(() => props.blink, value => { if (value) void play('Blink') })
watch(() => props.action, (value, previous) => { if (value !== previous) void play('Nod') })
watch(() => props.state, (value, previous) => {
  if (value === previous) return
  if (value === 'success') void play('Nod')
  else if (value === 'warning') void play('Shake')
  else if (value === 'curious') void play('Nod')
})

onMounted(create)
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  // The library stage and the detached pet can render the same cached model at once.
  // Destroy only this display tree; shared texture/base-texture ownership stays with PIXI.
  model?.destroy({ children: true, texture: false, baseTexture: false })
  app?.destroy(true, { children: true, texture: false, baseTexture: false })
  model = undefined
  app = undefined
})
</script>

<template>
  <span ref="stage" class="live2d-companion" :data-ready="!loading && !failed">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <span v-if="loading" class="live2d-status">LIVE2D / LOADING</span>
    <span v-else-if="failed" class="live2d-status failed">LIVE2D / UNAVAILABLE</span>
  </span>
</template>

<style scoped>
.live2d-companion{position:relative;display:block;inline-size:100%;block-size:100%;overflow:visible}.live2d-companion canvas{display:block;inline-size:100%;block-size:100%}.live2d-status{position:absolute;inset-inline:0;inset-block-end:.25rem;text-align:center;color:var(--color-muted);font:500 .5rem/1.4 var(--sans);letter-spacing:.12em}.live2d-status.failed{color:var(--color-danger,#a24c42)}
</style>
