<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import poster from '../../../assets/visuals/pet-videos/poster.png'
import { resolvePetAnimation, type PetAnimation } from '../services/pet-action-motion'
import { petVideoClip } from '../services/pet-video-assets'
import { createPetVideoPlayer, type PetVideoState } from '../services/pet-video-player'
import type { CompanionState } from '../services/companion-controller'

const props = withDefaults(defineProps<{
  state: CompanionState; intent?: string; paused: boolean; hidden: boolean
  tilt: number; action: number; settling: boolean; speaking: boolean; autoBlink: boolean
}>(), { intent: 'idle' })
const emit = defineEmits<{ started: [intent: PetAnimation, action: number] }>()
const surface = ref<HTMLElement>()
const playback = ref<PetVideoState>({ ready: false, failed: false, clip: 'idle', frames: 0 })
const desired = computed(() => resolvePetAnimation(props.intent, props.state, props.speaking, props.settling))
// Idle contains its own blink. Do not overlay a second timer or eye animation.
const reduced = computed(() => props.paused || (!props.autoBlink && desired.value === 'idle'))
const rotation = computed(() => props.hidden || reduced.value ? 0 : Math.max(-10, Math.min(10, props.tilt)))
let player: ReturnType<typeof createPetVideoPlayer> | undefined
function activity() { player?.activity({ hidden: props.hidden, reduced: reduced.value }) }
function select() { activity(); player?.select(petVideoClip(desired.value), desired.value, props.action) }
watch(() => [props.action, desired.value], select)
watch(() => [props.hidden, reduced.value], activity)
onMounted(() => {
  player = createPetVideoPlayer(surface.value!, {
    state: value => { playback.value = value },
    started: (intent, action) => emit('started', intent as PetAnimation, action)
  })
  select()
})
onBeforeUnmount(() => player?.dispose())
</script>

<template>
  <span class="pet-artwork" :data-ready="playback.ready" :data-intent="intent" :data-clip="playback.clip" :data-frame-count="playback.frames" :data-asset-error="playback.failed" :data-motion="reduced || hidden ? 'paused' : 'active'" data-animation-system="video" data-testid="pet-artwork" aria-hidden="true">
    <img v-if="!playback.ready" class="artwork-fallback" :src="poster" alt="" />
    <span ref="surface" class="video-surface" :style="{ transform: 'rotate(' + rotation + 'deg)' }" />
  </span>
</template>

<style scoped>
.pet-artwork{position:relative;display:block;width:100%;height:100%;min-width:0;overflow:hidden;pointer-events:none}
.video-surface{position:absolute;inset:0;display:block;transform-origin:50% 90%;transition:transform 100ms ease-out}
.video-surface :deep(video),.artwork-fallback{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
.pet-artwork[data-motion="paused"] .video-surface{transition:none}
</style>
