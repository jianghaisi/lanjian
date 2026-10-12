<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import avatar from './assets/lanjian-capsule-avatar-v1.png'
const props = defineProps<{ focused: boolean }>()
const host = ref<HTMLElement>(), x = ref(0), y = ref(0), active = ref(false), reduced = ref(false)
const closed = ref(false), loaded = ref(false), clipId = useId(), skinId = useId()
// The approved raster stays intact. Its two eye regions are separate SVG layers,
// so eyelids and gaze move independently of the surrounding face and hair.
const eyes = [{ x: 427, y: 779, angle: 24, height: 216 }, { x: 764, y: 937, angle: 25, height: 206 }]
const eyeOffset = computed(() => `translate(${active.value ? props.focused ? 17 : x.value * 10 : 0} ${active.value ? props.focused ? -10 : y.value * 7 : 0})`)
const eyelid = computed(() => `scale(1 ${active.value && closed.value ? .045 : active.value && props.focused ? 1.07 : 1})`)
let blinkTimer = 0
let media: MediaQueryList, observer: IntersectionObserver | undefined, frame = 0, visible = true
let targetX = 0, targetY = 0
const motion = computed(() => ({ '--look-x': `${x.value * 12}px`, '--look-y': `${y.value * 8}px`, '--turn-x': `${-y.value * 3}deg`, '--turn-y': `${x.value * 4}deg`, animationPlayState: active.value ? 'running' : 'paused' }))
function status() { active.value = visible && !document.hidden && !reduced.value; if (!active.value) { cancelAnimationFrame(frame); frame = 0; x.value = y.value = 0 } }
function preference() { reduced.value = media.matches; status() }
function pointer(event: PointerEvent) {
  if (!active.value || event.pointerType === 'touch') return
  targetX = Math.max(-1, Math.min(1, (event.clientX / innerWidth - .5) * 2))
  targetY = Math.max(-1, Math.min(1, (event.clientY / innerHeight - .5) * 2))
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; x.value = targetX; y.value = targetY })
}
function reset() { x.value = y.value = 0 }
// Same bounded gaze / 3–7 second blink timing as animatedlogin-react (MIT).
// No password field is introduced into the Linux DO authorization flow.
function scheduleBlink() {
  clearTimeout(blinkTimer)
  if (!active.value) return
  blinkTimer = window.setTimeout(() => {
    closed.value = true
    blinkTimer = window.setTimeout(() => { closed.value = false; scheduleBlink() }, 140)
  }, 3000 + Math.random() * 4000)
}
watch(active, enabled => { clearTimeout(blinkTimer); closed.value = false; if (enabled) scheduleBlink() })
onMounted(() => {
  media = matchMedia('(prefers-reduced-motion: reduce)'); preference(); media.addEventListener('change', preference)
  observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); status() })
  observer.observe(host.value!)
  window.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('blur', reset)
  document.addEventListener('visibilitychange', status)
})
onBeforeUnmount(() => { clearTimeout(blinkTimer); cancelAnimationFrame(frame); observer?.disconnect(); media?.removeEventListener('change', preference); window.removeEventListener('pointermove', pointer); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', status) })
</script>

<template>
  <div ref="host" class="login-mascot" :class="{ attentive: focused, resting: !active }" :style="motion" data-testid="login-mascot" aria-hidden="true">
    <div class="mascot-arrival"><div class="mascot-gaze"><div class="mascot-body">
      <img :src="avatar" width="1254" height="1254" alt="" fetchpriority="high" draggable="false" @load="loaded = true">
      <svg v-if="loaded" class="mascot-eyes" viewBox="0 0 1254 1254" :data-blinking="closed" :data-active="active">
        <defs>
          <clipPath :id="clipId"><rect x="-53" y="-110" width="106" height="220" rx="53" /></clipPath>
          <radialGradient :id="skinId"><stop offset="0" stop-color="#fdebdc"/><stop offset=".84" stop-color="#fdebdc"/><stop offset="1" stop-color="#fdebdc" stop-opacity="0"/></radialGradient>
        </defs>
        <g v-for="(eye, i) in eyes" :key="i" :transform="`translate(${eye.x} ${eye.y}) rotate(${eye.angle})`">
          <rect x="-61" :y="-eye.height / 2 - 6" width="122" :height="eye.height + 12" rx="61" fill="#fdebdc"/>
          <ellipse rx="76" :ry="eye.height / 2 + 24" :fill="`url(#${skinId})`" />
          <g class="mascot-eye-look" :transform="eyeOffset"><g class="mascot-eyelid" :transform="eyelid" :clip-path="`url(#${clipId})`">
            <image :href="avatar" width="1254" height="1254" :transform="`rotate(${-eye.angle}) translate(${-eye.x} ${-eye.y})`" />
          </g></g>
        </g>
      </svg>
    </div></div></div>
  </div>
</template>

<style scoped>
.login-mascot{position:relative;width:min(100%,58svh,620px);aspect-ratio:1;flex:none;align-self:center;margin:auto auto 0;perspective:900px;isolation:isolate}
.mascot-arrival{width:100%;height:100%;animation:mascot-arrive 1.25s cubic-bezier(.16,1,.3,1) both}
.mascot-gaze{width:100%;height:100%;transform:translate3d(var(--look-x),var(--look-y),0) rotateX(var(--turn-x)) rotateY(var(--turn-y));transition:transform .65s cubic-bezier(.22,1,.36,1)}
.mascot-body{position:relative;width:100%;height:100%;transform-origin:50% 80%;animation:mascot-breathe 7s ease-in-out infinite;transition:filter .5s,translate .6s cubic-bezier(.22,1,.36,1),rotate .6s cubic-bezier(.22,1,.36,1);mask-image:linear-gradient(to bottom,transparent 0%,#000 9%,#000 100%)}
img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}.mascot-eyes{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.mascot-eye-look{transition:transform .2s ease-out}
.attentive:not(.resting) .mascot-body{translate:8px -20px;rotate:2deg;filter:brightness(1.07)}.resting .mascot-body{animation-play-state:paused}
@keyframes mascot-arrive{from{opacity:0;transform:translate(-35px,65px) rotate(-6deg)}to{opacity:1;transform:translate(0,0) rotate(0)}}
@keyframes mascot-breathe{0%,100%{transform:translateY(3px) rotate(-.7deg)}50%{transform:translateY(-5px) rotate(.4deg)}}
@media(max-width:760px){.login-mascot{position:absolute;width:min(54vw,230px);right:-15px;bottom:37px;margin:0;z-index:0}.mascot-arrival{animation-duration:1s}}
@media(prefers-reduced-motion:reduce){.mascot-arrival,.mascot-gaze,.mascot-body,.mascot-eye-look{animation:none;transition:none;transform:none;translate:none;rotate:none}}
</style>
