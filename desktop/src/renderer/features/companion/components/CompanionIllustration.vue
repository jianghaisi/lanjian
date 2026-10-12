<script setup lang="ts">
import chibiArtwork from '../../../assets/visuals/character-q-current.png'
import blinkArtwork from '../../../assets/visuals/character-q-current-blink.png'
import speakingArtwork from '../../../assets/visuals/character-q-current-speaking.png'
import type { CompanionMode, CompanionState } from '../services/companion-controller'
withDefaults(defineProps<{ mode?: CompanionMode; state?: CompanionState; blink?: boolean; speaking?: boolean; paused?: boolean; intent?: 'idle'|'listening'|'thinking'|'eating'|'playing'|'sleeping'|'success'; gazeX?: number; gazeY?: number }>(), { mode: 'chibi', state: 'idle', blink: false, speaking: false, paused: false, gazeX: 0, gazeY: 0 })
</script>
<template>
  <span class="companion-illustration" :class="[mode, state, intent, { paused }]" aria-hidden="true">
    <img :src="chibiArtwork" alt="">
    <img v-if="(blink && !paused) || state === 'sleeping'" class="expression eyes" :src="blinkArtwork" alt="">
    <img v-if="speaking" class="expression voice-mouth" :src="speakingArtwork" alt="">
    <span v-if="intent && intent !== 'idle'" class="pet-prop">{{ {listening:'♫',thinking:'…',eating:'🍡',playing:'✧',sleeping:'z Z',success:'✦'}[intent] }}</span>
  </span>
</template>
<style scoped>
.voice-mouth{clip-path:polygon(48% 31%,54% 31%,54% 35.5%,48% 35.5%);animation:pet-mouth .32s steps(1,end) infinite}.paused .voice-mouth{animation:none}@keyframes pet-mouth{0%,100%{opacity:1}55%{opacity:0}}
.companion-illustration{position:relative;display:block;inline-size:100%;block-size:100%;filter:drop-shadow(0 .2rem .3rem #1d22202b);transform-origin:center bottom}.companion-illustration img{display:block;width:100%;height:100%;object-fit:contain}.expression{position:absolute;inset:0}.eyes{clip-path:polygon(40% 25%,62% 25%,62% 32%,40% 32%)}.companion-illustration.thinking,.companion-illustration.writing{animation:companion-working 1.8s ease-in-out infinite}.companion-illustration.success{animation:companion-success .6s ease-out}.companion-illustration.paused{animation:none}@keyframes companion-working{50%{transform:translateY(-2%) rotate(-.8deg)}}@keyframes companion-success{45%{transform:translateY(-5%) scale(1.03)}}
</style>
<style scoped>
.pet-prop{position:absolute;right:7%;top:23%;font:23px/1.2 Georgia,serif;color:#648571;text-shadow:0 1px 4px #fff}.eating .pet-prop{top:42%;right:38%;font-size:20px;animation:pet-nibble .7s ease-in-out infinite}.playing{animation:pet-play .8s ease-in-out infinite}.listening .pet-prop{animation:pet-listen 1s ease-in-out infinite}.sleeping .pet-prop{font-size:17px}.paused,.paused .pet-prop{animation:none!important}@keyframes pet-nibble{50%{transform:translateY(-4px) rotate(-9deg)}}@keyframes pet-play{50%{transform:rotate(2deg) translateY(-3%)}}@keyframes pet-listen{50%{opacity:.35}}
</style>
