<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
defineProps<{ scene: number; preview: string }>()
const hidden = ref(false)
const visibility = () => { hidden.value = document.hidden }
onMounted(() => { visibility(); document.addEventListener('visibilitychange', visibility) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', visibility))
// Open contours leave the actual manuscript uncovered. Layered strokes describe
// the transmitted colour, dark refraction and sharp reflected edges of each tube.
const streams = [
  'M 20,590 C -30,425 65,390 40,210 C 21,75 122,4 320,29 C 465,50 542,-24 735,18 C 922,59 1077,15 1080,210',
  'M 1080,162 C 1150,280 1040,342 1084,491 C 1132,660 935,700 735,670 C 588,647 526,724 325,690 C 134,660 48,717 20,590',
  'M 75,640 C -20,493 58,387 13,219 C -12,108 64,20 216,54 C 348,86 385,8 516,32',
]
</script>
<template>
  <div class="product-glass" :class="{'glass-hidden':hidden}" aria-hidden="true">
    <svg :key="`${scene}-${preview}`" class="glass-sculpture" viewBox="0 0 1100 720" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="product-glass-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7aa592" stop-opacity=".13"/><stop offset=".22" stop-color="#d7eee3" stop-opacity=".8"/>
          <stop offset=".39" stop-color="#3f665a" stop-opacity=".38"/><stop offset=".52" stop-color="#fff8e5" stop-opacity=".98"/>
          <stop offset=".64" stop-color="#b47b36" stop-opacity=".7"/><stop offset=".79" stop-color="#6b9b8d" stop-opacity=".45"/><stop offset="1" stop-color="#d9b16f" stop-opacity=".85"/>
        </linearGradient>
        <linearGradient id="product-metal-edge" x1="0" y1="1" x2="1" y2="0">
          <stop stop-color="#2e4f45"/><stop offset=".2" stop-color="#e0c698"/><stop offset=".4" stop-color="#faf9ec"/>
          <stop offset=".48" stop-color="#44665d"/><stop offset=".56" stop-color="#f6dfb4"/><stop offset=".8" stop-color="#ac773a"/><stop offset="1" stop-color="#fbfaf2"/>
        </linearGradient>
        <filter id="product-glass-shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <g v-for="(path,index) in streams" :key="path" :style="{'--stream-delay':`${index*160}ms`}" class="glass-stream" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path :d="path" pathLength="100" class="glass-grow glass-shadow" stroke="#385b4d" stroke-width="33" filter="url(#product-glass-shadow)" opacity=".13" transform="translate(0 10)"/>
        <path :d="path" pathLength="100" class="glass-grow" stroke="url(#product-glass-body)" :stroke-width="index===2?17:29"/>
        <path :d="path" pathLength="100" class="glass-grow" stroke="url(#product-metal-edge)" :stroke-width="index===2?9:19" opacity=".68"/>
        <path :d="path" pathLength="100" class="glass-grow" stroke="#f6f8ef" :stroke-width="index===2?5:12" opacity=".66"/>
        <path :d="path" pathLength="100" class="glass-grow" stroke="#709c8d" :stroke-width="index===2?3:8" opacity=".44"/>
        <path :d="path" pathLength="100" class="glass-grow glass-rim" stroke="#fffdf1" stroke-width="1.6" transform="translate(-2 -5)"/>
        <path :d="path" pathLength="100" class="glass-flow" stroke="#fff9dc" stroke-width="3"/>
        <path :d="path" pathLength="100" class="glass-flow glass-flow-metal" stroke="#b68240" stroke-width="1.4"/>
      </g>
    </svg>
  </div>
</template>
<style>
.product-glass{position:absolute;inset:-44px -40px -36px;pointer-events:none;z-index:0;overflow:hidden}
.glass-sculpture{width:100%;height:100%;display:block;overflow:visible;animation:glass-camera 3.4s cubic-bezier(.16,1,.3,1) both}
.glass-grow{stroke-dasharray:100;stroke-dashoffset:100;animation:glass-grow 2.8s cubic-bezier(.36,0,.14,1) var(--stream-delay) both}
.glass-rim{opacity:.85}.glass-flow{stroke-dasharray:.3 1.2 .15 14;stroke-dashoffset:100;opacity:0;animation:glass-light 2s 2.4s forwards,glass-current 15s 2.4s linear infinite}
.glass-flow-metal{stroke-dasharray:2 22;animation-duration:2s,24s;animation-direction:normal,reverse}
.glass-hidden *,.motion-paused .product-glass *{animation-play-state:paused!important}
@keyframes glass-grow{0%{stroke-dashoffset:100;opacity:0}9%{opacity:1}100%{stroke-dashoffset:0}}
@keyframes glass-camera{from{transform:perspective(1100px) rotateX(8deg) scale(1.065);opacity:.2}to{transform:perspective(1100px) rotateX(0) scale(1);opacity:1}}
@keyframes glass-light{to{opacity:.9}}@keyframes glass-current{to{stroke-dashoffset:0}}
@media(max-width:760px){.product-glass{inset:-26px -12px -22px}.glass-shadow{display:none}}
@media(prefers-reduced-motion:reduce){.product-glass *{animation:none!important}.glass-grow{stroke-dashoffset:0}.glass-flow{opacity:.65}}
</style>
