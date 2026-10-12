<script setup lang="ts">
import { computed, ref, shallowRef, onMounted } from 'vue'
import { CopilotChatView } from '@copilotkit/vue/v2'
import type { ReadingPosition } from '../services/assistant-memory'
import { copilotMessages, type AssistantTurn } from '../services/assistant-presentation'
import { useAssistantChatPosition } from '../composables/use-assistant-chat-position'
const props = defineProps<{ turns: AssistantTurn[]; busy: boolean; position?: ReadingPosition; restoreRevision?: number; visible?: boolean; scopeEpoch: number; loading: boolean }>()
const emit=defineEmits<{position:[value:ReadingPosition]}>()
const host=ref<HTMLElement>()
const scroll=shallowRef<HTMLElement>()
const {ready}=useAssistantChatPosition(scroll,()=>({scope:props.scopeEpoch,revision:props.restoreRevision??0,visible:props.visible!==false,loading:props.loading,position:props.position}),value=>emit('position',value))
onMounted(()=>{scroll.value=host.value?.querySelector<HTMLElement>('[data-testid="copilot-chat-view-scroll"]')??undefined})
const messages = computed(() => copilotMessages(props.turns))
</script>

<template>
  <!-- Controlled view only: no Copilot runtime/provider, remote thread or second tool dispatcher. -->
  <div ref="host" class="assistant-surface-host"><CopilotChatView class="lanjian-chat-surface" :messages="messages" :is-running="busy" :welcome-screen="false" :auto-scroll="ready?'pin-to-bottom':'none'">
    <template #message-view><slot /></template>
    <template #input><slot name="composer" /></template>
    <template #scroll-to-bottom-button="{ onClick }"><button class="assistant-latest" type="button" data-testid="assistant-latest" @click="onClick">↓ 回到最新</button></template>
  </CopilotChatView></div>
</template>

<style scoped>
/* Local view skin; intentionally do not load the upstream global stylesheet. */
.assistant-surface-host { height:100%; min-height:0; flex:1; }
.lanjian-chat-surface { position:relative; display:grid; grid-template-rows:minmax(0,1fr) auto; height:100%; min-height:0; flex:1; }
.lanjian-chat-surface :deep([data-testid="copilot-chat-view-scroll"]) { grid-row:1; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; scrollbar-gutter:stable; }
/* The composer occupies its own row; do not also reserve the upstream overlay height. */
.lanjian-chat-surface :deep([data-testid="copilot-scroll-content"]) { padding-bottom:0!important; }
.lanjian-chat-surface :deep([data-testid="copilot-chat-view-feather"]) { display:none; }
.lanjian-chat-surface :deep([data-testid="copilot-input-overlay"]) { grid-row:2; position:relative; min-width:0; z-index:2; }
.lanjian-chat-surface :deep([data-testid="copilot-chat-view-feather"] + div[style]) { position:absolute; left:0; right:0; z-index:3; display:flex; justify-content:center; pointer-events:none; }
.assistant-latest { pointer-events:auto; padding:6px 12px; border:1px solid var(--line-strong); background:var(--surface); color:var(--ink); box-shadow:0 2px 8px #0001; border-radius:10px; font:500 12px/1.5 var(--sans); cursor:pointer; }
</style>
