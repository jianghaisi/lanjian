<script setup lang="ts">
import chibiArtwork from '../../../assets/visuals/character-q-pet-final-v2@2x.png'
import type { CompanionMode, CompanionState } from '../services/companion-controller'
withDefaults(defineProps<{ mode?: CompanionMode; state?: CompanionState; blink?: boolean; gazeX?: number; gazeY?: number }>(), { mode: 'chibi', state: 'idle', blink: false, gazeX: 0, gazeY: 0 })
</script>
<template>
  <img class="companion-illustration" :class="[mode, state]" :src="chibiArtwork" alt="" aria-hidden="true">
</template>
<style scoped>
.companion-illustration{display:block;inline-size:100%;block-size:100%;object-fit:contain;filter:drop-shadow(0 .2rem .3rem #1d22202b);transform-origin:center bottom}.companion-illustration.thinking,.companion-illustration.writing{animation:companion-working 1.8s ease-in-out infinite}.companion-illustration.success{animation:companion-success .6s ease-out}@keyframes companion-working{50%{transform:translateY(-2%) rotate(-.8deg)}}@keyframes companion-success{45%{transform:translateY(-5%) scale(1.03)}}
</style>
