<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef } from 'vue'
import { useCompanionVoice } from '../composables/use-companion-voice'
import CompanionChatComposer from './CompanionChatComposer.vue'

const props = defineProps<{ continueWorkId: string | null; composerStyle: Record<string, string> }>()
const draft = defineModel<string>('draft', { required: true })
const emit = defineEmits<{ close: []; composerHeight: [height: number] }>()
const { text, input, error, ready, busy, playing, stateLabel, run, stop } = useCompanionVoice(toRef(props, 'continueWorkId'), { input: draft })
const composer = ref<InstanceType<typeof CompanionChatComposer>>()
let observer: ResizeObserver | undefined
defineExpose({ stop, busy, playing })
onMounted(async () => {
  await nextTick()
  const element = composer.value?.element
  if (!element) return
  observer = new ResizeObserver(() => emit('composerHeight', element.getBoundingClientRect().height))
  observer.observe(element)
  element.querySelector('textarea')?.focus({ preventScroll: true })
})
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <div class="companion-conversation" :data-playing="playing" :data-busy="busy" data-testid="companion-conversation">
    <p class="companion-reply" data-testid="companion-reply">{{ text }}</p>
    <Teleport to="body">
      <Transition name="composer" appear>
        <CompanionChatComposer ref="composer" v-model="input" :style="composerStyle" :ready="ready" :busy="busy" :playing="playing" :state-label="stateLabel" :error="error" @send="run()" @stop="stop" @replay="run('replay')" @close="emit('close')" />
      </Transition>
    </Teleport>
  </div>
</template>
<style scoped>
.companion-conversation{min-inline-size:0;color:var(--ink)}.companion-reply{font:inherit;overflow-wrap:anywhere}
.composer-enter-active{transition:opacity .22s ease,transform .22s ease}.composer-enter-from{opacity:0;transform:translateY(.5rem)}
</style>
