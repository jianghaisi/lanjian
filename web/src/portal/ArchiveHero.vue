<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GlassSurface from './GlassSurface.vue'
import ParticleField from './ParticleField.vue'
import companion from './assets/glass-entity-front.webp'
import arm from './assets/glass-arm-v1.webp'
import { usePortalMusic } from './usePortalMusic'

defineProps<{ scene: number }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const music = usePortalMusic()
const host = ref<HTMLElement>(), person = ref<HTMLElement>(), entry = ref<HTMLAnchorElement>(), welcome = ref<HTMLButtonElement>()
const phase = ref<'welcome' | 'face' | 'retreat' | 'entered'>('welcome')
const paused = ref(false), suspended = ref(false), skipped = ref(false), assetError = ref(false)
const loaded = ref<string[]>([])
const ready = computed(() => loaded.value.length === 3)
const camera = ref('translate(0px, 0px) scale(4)')
let cleanup = () => {}, timers: number[] = [], restoreScroll = () => {}, measure = () => {}
function resourceReady(id: string) { if (!loaded.value.includes(id)) loaded.value.push(id); void nextTick(measure) }
function cancelTimers() { timers.forEach(window.clearTimeout); timers = [] }
function finish(immediate = false) {
  if (phase.value === 'welcome') music.setScene('reveal')
  cancelTimers(); skipped.value = immediate; phase.value = 'entered'; emit('active', false); restoreScroll()
  void nextTick(() => entry.value?.focus({ preventScroll: true }))
}
function enter() {
  if (phase.value !== 'welcome') return
  music.setScene('reveal', true)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || assetError.value) { finish(true); return }
  skipped.value = false; measure(); phase.value = 'face'
  timers.push(window.setTimeout(() => { phase.value = 'retreat' }, 4300))
  timers.push(window.setTimeout(() => finish(), 7350))
}
function replay() {
  music.setScene('welcome', true)
  cancelTimers(); window.scrollTo({ top: 0, behavior: 'instant' }); skipped.value = true; phase.value = 'welcome'; paused.value = false
  emit('active', true); document.documentElement.style.overflow = 'hidden'
  void nextTick(() => { measure(); welcome.value?.focus({ preventScroll: true }); requestAnimationFrame(() => { skipped.value = false }) })
}
onMounted(() => {
  const element = host.value!, originalOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  restoreScroll = () => { if (document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = originalOverflow }
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0, visible = true, x = 0, y = 0
  measure = () => {
    const figure = person.value
    if (!figure) return
    const zoom = innerWidth <= 700 ? 2.4 : 3.2
    // Same image and camera throughout: close on the face, then retreat to the full figure.
    const faceX = figure.offsetLeft
    const faceY = figure.offsetTop + figure.offsetHeight * (.112 - .5)
    camera.value = `translate(${(element.clientWidth * .5 - faceX * zoom).toFixed(1)}px, ${(Math.min(element.clientHeight, innerHeight) * .46 - faceY * zoom).toFixed(1)}px) scale(${zoom})`
  }
  let cameraFrame = 0
  const unwatchCamera = watch(phase, value => {
    if (cameraFrame) cancelAnimationFrame(cameraFrame)
    cameraFrame = 0
    if (value !== 'face') return
    const start = performance.now()
    const track = (now: number) => {
      const figure = person.value
      if (!figure || phase.value !== 'face') return
      const t = Math.min(1, (now - start) / 4300)
      const ease = t * t * (3 - 2 * t)
      const zoom = (innerWidth <= 700 ? 2.4 : 3.2) * (1 - ease) + 1.05 * ease
      const faceY = figure.offsetTop + figure.offsetHeight * (.112 - .5)
      const focusY = faceY * (1 - ease) + figure.offsetTop * ease
      // Keep optical centre on the figure; track down from face to body while dollying out.
      camera.value = `translate(${(element.clientWidth * .5 - figure.offsetLeft * zoom).toFixed(1)}px, ${(element.clientHeight * .46 - focusY * zoom).toFixed(1)}px) scale(${zoom.toFixed(4)})`
      if (t < 1) cameraFrame = requestAnimationFrame(track)
    }
    cameraFrame = requestAnimationFrame(track)
  })
  const resize = new ResizeObserver(measure); resize.observe(element)
  const paint = () => {
    frame = 0
    if (!visible || document.hidden || paused.value || motion.matches || phase.value !== 'entered') return
    element.style.setProperty('--pointer-x', `${x.toFixed(2)}px`)
    element.style.setProperty('--pointer-y', `${y.toFixed(2)}px`)
  }
  const pointer = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    const box = element.getBoundingClientRect()
    x = ((event.clientX - box.left) / box.width - .5) * 14
    y = ((event.clientY - box.top) / box.height - .5) * 10
    if (!frame) frame = requestAnimationFrame(paint)
  }
  const visibility = () => { suspended.value = document.hidden || !visible }
  const observer = new IntersectionObserver(([item]) => { visible = !!item?.isIntersecting; visibility() }); observer.observe(element)
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && phase.value !== 'entered') { event.preventDefault(); finish(true) } }
  const changeMotion = () => { if (motion.matches && phase.value !== 'welcome' && phase.value !== 'entered') finish(true) }
  element.addEventListener('pointermove', pointer); document.addEventListener('visibilitychange', visibility)
  document.addEventListener('keydown', escape); motion.addEventListener('change', changeMotion)
  measure()
  cleanup = () => {
    unwatchCamera(); if (cameraFrame) cancelAnimationFrame(cameraFrame); cancelTimers(); if (frame) cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); restoreScroll()
    element.removeEventListener('pointermove', pointer); document.removeEventListener('visibilitychange', visibility)
    document.removeEventListener('keydown', escape); motion.removeEventListener('change', changeMotion)
  }
})
onBeforeUnmount(() => cleanup())
</script>

<template>
  <section ref="host" class="archive-hero" :class="[`phase-${phase}`, { 'motion-stopped': paused || suspended, 'skip-motion': skipped }]" :data-phase="phase" aria-label="岚笺玻璃开场">
    <div class="glass-environment" aria-hidden="true"><div class="amber-halo"></div><div class="glass-grid"></div><svg class="glass-orbits" viewBox="0 0 900 1100" fill="none"><g class="orbit-breath"><ellipse cx="450" cy="490" rx="360" ry="450" transform="rotate(-25 450 490)" /><ellipse cx="450" cy="490" rx="365" ry="450" transform="rotate(25 450 490)" stroke-dasharray="1 12" /></g><ellipse cx="450" cy="260" rx="360" ry="70" /><ellipse cx="450" cy="270" rx="360" ry="70" /><path d="M140 -80v190q0 130 210 150M760 -80v190q0 130-210 150M450 950v120M425 1045l25 25 25-25"/><circle cx="188" cy="840" r="9"/><circle cx="712" cy="140" r="7"/></svg></div>
    <div class="hero-world" aria-hidden="true"><div class="glass-camera" :style="{ transform: phase === 'welcome' || phase === 'face' ? camera : 'translate(0px, 0px) scale(1)' }"><div ref="person" class="glass-person"><div class="person-parallax"><GlassSurface :growth-stage="phase === 'welcome' ? 'idle' : skipped || phase === 'entered' ? 'complete' : 'growing'" liquid-growth gold-shards priority="low" :src="companion" :paused="paused || suspended || phase === 'welcome'" :intensity="1.15" @ready="resourceReady('body')" @error="assetError = true" /></div></div></div></div>
    <ParticleField v-if="phase !== 'welcome'" :paused="paused || suspended || phase !== 'entered'" :scene="scene" :class="{ 'field-visible': phase === 'entered' }" />
    <div class="scene-vignette" aria-hidden="true"></div>
    <div class="prologue-veil" aria-hidden="true"></div>
    <div v-if="phase !== 'entered'" class="prologue-arms" aria-hidden="true"><div class="arm-left"><div class="arm-drift"><GlassSurface liquid-growth priority="high" :src="arm" :paused="suspended" :intensity=".65" @ready="resourceReady('left')" @error="assetError = true" /></div></div><div class="arm-right"><div class="arm-drift"><GlassSurface liquid-growth priority="high" :src="arm" :paused="suspended" :intensity=".65" @ready="resourceReady('right')" @error="assetError = true" /></div></div></div>
    <div v-if="phase !== 'entered'" class="prologue-ui" :inert="phase !== 'welcome'"><span class="prologue-brand">岚笺 <small>LANJIAN</small></span><div class="welcome-centre"><p>想象，在此成形。</p><button ref="welcome" class="welcome-button" @click="enter"><span>WELCOME</span><i aria-hidden="true">↗</i></button><small>点击，进入故事的另一面</small><p v-if="assetError" role="status">图片未能载入，仍可直接进入。</p></div><span class="prologue-foot">A WORLD WAITING TO BE WRITTEN</span></div>
    <button class="portal-sound" :data-state="music.state.value" :aria-pressed="music.enabled.value" :title="music.state.value === 'idle' ? '声音默认开启，点击 WELCOME 即可播放' : undefined" @click="music.toggle"><span aria-hidden="true">{{ music.enabled.value ? '♫' : '♪' }}</span> {{ music.label.value }}</button>
    <button v-if="phase !== 'entered'" class="skip-prologue" @click="finish(true)">跳过开场 ↗</button>
    <div class="centre-gateway" :inert="phase !== 'entered'"><span class="gateway-line" aria-hidden="true"></span><a ref="entry" class="archive-entry" href="/login" aria-label="进入创作工作台"><span class="gateway-shape" aria-hidden="true"></span><span>进入<br>岚笺</span></a><span class="gateway-caption">ENTER THE ARCHIVE</span><span class="gateway-line lower" aria-hidden="true"></span></div>
    <div class="hero-controls" :inert="phase !== 'entered'"><button @click="replay">重播开场</button><button :aria-pressed="paused" @click="paused = !paused">{{ paused ? '播放背景动效' : '暂停背景动效' }}</button></div>
  </section>
</template>
<style scoped>
.portal-sound{position:absolute;left:4%;top:100px;z-index:10;border:1px solid #d5ad6a55;background:#0b0e10b8;color:#dfc296;font:var(--type-xs)/1.4 var(--sans);letter-spacing:.1em;padding:var(--space-xs) var(--space-sm);cursor:pointer;transition:background var(--duration-base) var(--ease-smooth),border-color var(--duration-base) var(--ease-smooth)}.portal-sound>span{margin-right:6px}.portal-sound:hover{background:#0f1214;border-color:#e5bc7f}.portal-sound:focus-visible{outline:2px solid #e9bd79;outline-offset:4px;border-radius:2px}@media(max-width:700px){.portal-sound{top:68px;left:6%;font-size:var(--type-xs);padding:6px 9px}}
.archive-hero{--pointer-x:0px;--pointer-y:0px;position:absolute;inset:0;overflow:hidden;background:#090b0d;color:#e9e4db;isolation:isolate}
.glass-environment,.hero-world,.glass-camera,.prologue-veil{position:absolute;inset:0;pointer-events:none}.amber-halo{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 43%,#7745203d,transparent 49%),radial-gradient(ellipse at 50% 94%,#5b697531,transparent 62%)}.glass-grid{position:absolute;inset:0;background:linear-gradient(90deg,transparent calc(50% - .5px),#beae9224 50%,transparent calc(50% + .5px));background-size:33.333vw 100%;mask-image:linear-gradient(transparent,#000 40%,transparent)}
.glass-camera{transform-origin:0 0;transition:transform 2.9s cubic-bezier(.2,.65,.15,1);will-change:transform}.phase-welcome .glass-camera,.phase-face .glass-camera{transition:none}.glass-person{position:absolute;left:50%;top:46%;width:min(58svh,58vw);transform:translate(-50%,-50%)}.person-parallax{transform:translate(var(--pointer-x),var(--pointer-y));transition:transform .7s ease-out;opacity:.92}.glass-orbits{position:absolute;left:50%;top:46%;width:min(76svh,78vw);transform:translate(-50%,-50%);stroke:#bdc2c0;stroke-width:.55;opacity:.23;transition:opacity 1.5s}.orbit-breath{transform-origin:450px 500px;animation:orbit-drift 24s ease-in-out infinite}.phase-welcome .glass-orbits,.phase-face .glass-orbits{opacity:0}.scene-vignette{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,#090b0de8,transparent 32% 68%,#090b0de8),linear-gradient(0deg,#090b0df5,transparent 24% 87%,#090b0d99)}
.prologue-veil{background:radial-gradient(ellipse at 50% 47%,#281a11,#090b0d 68%);z-index:2;transition:opacity 1.2s .15s}.phase-face .prologue-veil,.phase-retreat .prologue-veil,.phase-entered .prologue-veil{opacity:0}.prologue-arms{position:absolute;inset:0;z-index:3;pointer-events:none}.arm-left,.arm-right{position:absolute;top:34%;width:56%;transition:transform 1.8s cubic-bezier(.4,0,.1,1),opacity 1.6s 320ms var(--ease-exit);will-change:transform}.arm-left{left:-5%;transform:rotate(-8deg)}.arm-right{right:-5%;transform:scaleX(-1) rotate(-8deg)}.arm-drift{animation:arm-float 6s ease-in-out infinite}.arm-right .arm-drift{animation-delay:-3s}.phase-face .arm-left,.phase-retreat .arm-left{transform:translate(-85%,-25%) rotate(-24deg);opacity:0}.phase-face .arm-right,.phase-retreat .arm-right{transform:translate(85%,-25%) scaleX(-1) rotate(-24deg);opacity:0}
.prologue-ui{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;transition:opacity var(--duration-slow) var(--ease-exit)}.phase-face .prologue-ui,.phase-retreat .prologue-ui{opacity:0}.prologue-brand{position:absolute;top:40px;left:5%;font:500 clamp(1.375rem,2.5vw,1.625rem)/1 var(--serif);letter-spacing:.1em}.prologue-brand small{font:var(--type-xs)/1 var(--sans);letter-spacing:.14em;margin-left:var(--space-sm);color:#c2a87f}.welcome-centre{text-align:center;margin-top:24vh;position:relative}.welcome-centre>p:first-child{font:var(--type-sm)/1.8 var(--serif);letter-spacing:.42em;color:#e9c79a;margin:0 0 var(--space-md)}.welcome-button{display:flex;align-items:center;gap:clamp(1.5rem,3vw,2rem);border:0;border-block:1px solid #b984494d;padding:var(--space-sm) var(--space-md) var(--space-md);background:none;color:#f7eddd;cursor:pointer;transition:color var(--duration-base) var(--ease-smooth),border-color var(--duration-base) var(--ease-smooth)}.welcome-button>span{font:400 clamp(2rem,3.5vw,3.375rem)/1.1 Georgia,serif;letter-spacing:.12em}.welcome-button>i{font:clamp(1.5rem,2vw,1.75rem)/1 var(--sans);font-style:normal;color:#c99557;transition:transform var(--duration-base) var(--ease-smooth)}.welcome-button:hover{color:#edb778;border-color:#d4956b}.welcome-button:hover>i{transform:translate(4px,-4px)}.welcome-button:disabled{opacity:.5;cursor:wait}.welcome-centre>small{font:var(--type-xs)/1.8 var(--sans);letter-spacing:.12em;display:block;margin-top:var(--space-md);color:#bda989}.prologue-foot{position:absolute;bottom:30px;font:var(--type-xs)/1.5 var(--sans);letter-spacing:.16em;color:#b49c79}.skip-prologue{position:absolute;top:30px;right:4%;z-index:8;background:none;border:0;border-bottom:1px solid #baa27d70;color:#e5d2ae;font-size:var(--type-sm);padding:var(--space-xs) 4px;cursor:pointer;transition:color var(--duration-base) var(--ease-smooth),border-color var(--duration-base) var(--ease-smooth)}.skip-prologue:hover{color:#ffd9b8;border-color:#d4b794}
.centre-gateway{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;display:flex;flex-direction:column;align-items:center;opacity:0;pointer-events:none;transition:opacity 1.2s 600ms var(--ease-enter)}.phase-entered .centre-gateway{opacity:1;pointer-events:auto}.archive-entry{display:grid;place-items:center;position:relative;width:clamp(68px,9vw,80px);height:clamp(68px,9vw,80px);font:var(--type-sm)/1.6 var(--serif);text-align:center;letter-spacing:.14em;color:#fff6ed;cursor:pointer}.gateway-shape{position:absolute;inset:12px;transform:rotate(45deg);background:#8b302a;border:1px solid #f49a73;box-shadow:0 0 25px #ba4a2a66;transition:background var(--duration-base) var(--ease-smooth),box-shadow var(--duration-slow) var(--ease-smooth)}.gateway-shape::before,.gateway-shape::after{content:'';position:absolute;inset:-7px;border:1px solid #e3b0958a;transition:inset var(--duration-slow) var(--ease-smooth)}.gateway-shape::after{inset:-15px;border-color:#ce947548;animation:gateway-pulse 3s ease-in-out infinite}.archive-entry>span:last-child{position:relative}.archive-entry:hover .gateway-shape{background:#b24835;box-shadow:0 0 42px #eb683779}.archive-entry:hover .gateway-shape::before{inset:-12px}.gateway-caption{font:var(--type-xs)/1.5 var(--sans);letter-spacing:.16em;color:#f0c9ac;margin-top:var(--space-md);text-shadow:0 1px 6px #000;background:#090b0da6;padding:4px 8px;border-radius:2px}.gateway-line{height:clamp(28px,4vh,38px);width:1px;background:linear-gradient(transparent,#d8aa7b99);margin-bottom:var(--space-xs)}.gateway-line.lower{margin:var(--space-xs) 0 0;background:linear-gradient(#d8aa7b99,transparent);height:clamp(20px,3vh,28px)}.hero-controls{position:absolute;right:4%;top:100px;display:flex;gap:var(--space-sm);z-index:6;opacity:0;pointer-events:none;transition:opacity var(--duration-slower) var(--ease-enter)}.phase-entered .hero-controls{opacity:1;pointer-events:auto}.hero-controls button{border:0;background:none;font-size:var(--type-xs);color:#b9b0a6;padding:var(--space-2xs) 0;cursor:pointer;transition:color var(--duration-base) var(--ease-smooth)}.hero-controls button:hover{color:#ffc994}.particle-field{opacity:0;transition:opacity 1.8s var(--ease-enter)}.particle-field.field-visible{opacity:1}.motion-stopped *,.motion-stopped *::before,.motion-stopped *::after{animation-play-state:paused!important}.motion-stopped .person-parallax{transition:none}.skip-motion *{transition:none!important;animation:none!important}
@keyframes arm-float{50%{transform:translateY(9px) rotate(.8deg)}}@keyframes orbit-drift{50%{transform:rotate(8deg) scale(.96)}}@keyframes gateway-pulse{50%{opacity:.35;transform:scale(1.12)}}
@media(max-width:1100px) and (min-width:701px){.glass-person{width:min(58svh,44vw)}.hero-controls{right:3%;gap:12px}}
@media(max-width:700px){.glass-person{top:35%;width:min(83vw,56svh)}.glass-orbits{top:35%;width:min(107vw,75svh)}.scene-vignette{background:linear-gradient(0deg,#090b0dfa 0%,#090b0ddd 34%,transparent 55% 86%,#090b0d66)}.centre-gateway{top:39%}.archive-entry{width:60px;height:60px;font-size:10px}.gateway-shape{inset:10px}.gateway-caption{font-size:7px;margin-top:12px}.gateway-line{height:19px;margin-bottom:8px}.gateway-line.lower{height:13px}.hero-controls{top:68px;right:6%;gap:15px}.hero-controls button{font-size:8px}.prologue-brand{font-size:22px;top:33px;left:7%}.prologue-brand small{font-size:8px;margin-left:12px}.skip-prologue{right:7%;top:22px;font-size:10px}.arm-left,.arm-right{top:32%;width:87%}.arm-left{left:-31%;transform:rotate(8deg)}.arm-right{right:-31%;transform:scaleX(-1) rotate(8deg)}.welcome-centre{margin-top:15vh}.welcome-button{padding:15px 8px;gap:12px}.welcome-button>span{font-size:32px;letter-spacing:.1em}.welcome-button>i{font-size:22px}.welcome-centre>p:first-child{font-size:10px;letter-spacing:.3em}.prologue-foot{font-size:8px;letter-spacing:.1em}.phase-face .arm-left,.phase-retreat .arm-left{transform:translate(-90%,-40%) rotate(-28deg)}.phase-face .arm-right,.phase-retreat .arm-right{transform:translate(90%,-40%) scaleX(-1) rotate(-28deg)}}
@media(prefers-reduced-motion:reduce){.archive-hero *,.archive-hero *::after{animation:none!important;transition:none!important}.person-parallax{transform:none}}
</style>
