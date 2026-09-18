<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import type { FieldAssistantApi } from '../../../../contracts/assistant/field-assistant-contracts'
import type { ModelCatalogChoice, ModelConnectionSummary } from '../../models/services/model-catalog'
import { fieldAssistantIntent, fieldRegistry } from '../services/assistant-field-registry'
import { useFieldAssistant } from '../composables/use-field-assistant'
import FieldAssistantCandidate from './FieldAssistantCandidate.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import ModelCatalogPicker from '../../models/components/ModelCatalogPicker.vue'
import ApplicationModelSettings from '../../models/components/ApplicationModelSettings.vue'
import type { AssistantWorkspaceId } from '../../../../contracts/assistant/assistant-workspace-contracts'

const props=defineProps<{api:FieldAssistantApi;page:string;pageLabel:string;hasBook:boolean;hasChapter:boolean;chapterId?:number|null;selectedCharacters?:number;proseSnapshot?:string;taskActive:boolean;alwaysConfirmBeforeSend?:boolean;models?:ModelCatalogChoice[];connections?:ModelConnectionSummary[];navigateHandler?:(id:AssistantWorkspaceId)=>Promise<void>;proseHandler?:(input:{message:string;model?:string;connectionId?:string;maxTokensOverride?:number})=>Promise<void>}>()
const open=defineModel<boolean>('open',{required:true}),mode=defineModel<string>('mode',{required:true})
const portal=ref<HTMLDialogElement|null>(null),composer=ref<HTMLTextAreaElement>(),conversationEnd=ref<HTMLElement>()
const assistant=useFieldAssistant(props.api,{page:()=>props.page,chapterId:()=>props.chapterId||null,selectedCharacters:()=>props.selectedCharacters||0,proseSnapshot:()=>props.proseSnapshot||'',requiresPreview:()=>Boolean(props.hasBook&&props.alwaysConfirmBeforeSend),navigate:async id=>{if(!props.navigateHandler)throw new Error('当前作品暂时无法定位目标。');await props.navigateHandler(id)},prose:async input=>{if(!props.proseHandler)throw new Error('请先打开要处理的章节。');await props.proseHandler(input)}})
const {instruction,busy,error,progressText,reviewText,turns,history,candidate,applying,undo,currentCandidate,message,model,connectionId,maxTokensOverride}=assistant
watch(()=>fieldAssistantIntent.serial,async()=>{portal.value=fieldRegistry.get(fieldAssistantIntent.key)?.element?.closest('dialog[open]') as HTMLDialogElement|null;open.value=true;mode.value='agent';await nextTick();composer.value?.focus()})
watch(open,value=>{if(value)void assistant.refreshHistory()})
watch(mode,value=>{if(value==='tasks')void assistant.refreshHistory()})
watch([()=>turns.value.length,()=>candidate.value?.id,()=>Boolean(error.value)],async()=>{await nextTick();conversationEnd.value?.scrollIntoView({block:'nearest'})})
function closePortal(event:Event){if(event.target===portal.value){portal.value=null;open.value=false}}
onMounted(()=>document.addEventListener('close',closePortal,true))
onBeforeUnmount(()=>document.removeEventListener('close',closePortal,true))
async function compose(text:string){open.value=true;mode.value='agent';instruction.value=text;await nextTick();composer.value?.focus()}
async function sendInstruction(text:string){await compose(text);await assistant.send()}
defineExpose({sendInstruction,compose})
</script>
<template>
  <Teleport :disabled="!portal" :to="portal || 'body'">
  <aside v-show="open" id="assistant-drawer" class="assistant-panel global-assistant-host" :class="{'application-assistant':!hasBook,'dialog-assistant':Boolean(portal)}" role="complementary" aria-label="智能助笔" data-testid="assistant-sidebar" data-layout="sidebar">
    <header><div><StudioIcon name="spark" :size="18"/><span>智能助笔</span></div><nav class="assistant-mode-switch" aria-label="智能助笔区域"><button v-for="tab in [{id:'agent',label:'对话'},{id:'checks',label:'核对'},{id:'tasks',label:'任务'}]" :key="tab.id" type="button" :class="{active:mode===tab.id}" :aria-pressed="mode===tab.id" :data-testid="`assistant-mode-${tab.id}`" @click="mode=tab.id">{{ tab.label }}<span v-if="tab.id==='tasks'&&(taskActive||busy)" class="assistant-task-dot" aria-label="有待处理任务"></span></button></nav><button type="button" aria-label="关闭智能助笔侧栏" @click="open=false"><StudioIcon name="close" :size="17"/></button></header>
    <div class="assistant-panel-body">
      <section v-show="mode==='agent'" class="assistant-mode-page assistant-agent-page" data-testid="assistant-agent-page">
        <section class="field-assistant" data-testid="field-assistant-panel">
          <div class="assistant-conversation" aria-live="polite">
            <div v-if="!turns.length&&!candidate" class="field-assistant-intro"><span>{{ pageLabel }}</span><h3>说说你想怎么改</h3><p>修改设想、完善设定，或接着写下去。把想法告诉我就好。</p><button type="button" class="assistant-example" @click="compose('帮我完善核心设想，')">帮我完善核心设想</button></div>
            <article v-for="(turn,index) in turns" :key="index" class="assistant-chat-message" :class="turn.role"><span>{{ turn.role==='user'?'你':'智能助笔' }}</span><p>{{ turn.content }}</p><details v-if="turn.tools?.length"><summary>已查看 {{ turn.tools.length }} 项</summary><ul><li v-for="(step,i) in turn.tools" :key="i">{{ step }}</li></ul></details></article>
            <p v-if="busy" class="assistant-chat-progress" role="status"><StudioIcon name="spark" :size="14"/>{{ progressText || '正在准备修改候选……' }}</p>
            <FieldAssistantCandidate v-if="candidate" :candidate="candidate" :current="currentCandidate" :busy="applying" :can-undo="Boolean(undo)" :message="message" @apply="assistant.apply" @undo="assistant.undoApply"/>
            <div v-if="hasChapter" class="assistant-prose-results"><slot name="prose"/></div>
            <details v-if="reviewText" class="field-context-preview" open><summary>本次发送的内容</summary><pre>{{ reviewText }}</pre><p>核对后点击“发送”继续。</p></details>
            <p v-if="error" class="field-assistant-error" role="alert">{{ error }}</p>
            <span ref="conversationEnd"></span>
          </div>
          <form class="field-assistant-composer" @submit.prevent="assistant.send">
            <textarea ref="composer" v-model="instruction" data-testid="field-assistant-instruction" aria-label="给智能助笔发送消息" maxlength="10000" placeholder="例如：修改核心设想，让主角能听见旧物的记忆……" @keydown.enter="if(($event.ctrlKey||$event.metaKey)&&!$event.isComposing){$event.preventDefault();assistant.send()}"/>
            <footer><ModelCatalogPicker v-if="hasBook&&connections?.length" :choices="models||[]" :connections="connections||[]" :model="model" :connection-id="connectionId" label="" :disabled="busy||taskActive" compact allow-empty allow-manual empty-label="跟随任务模型" @select="choice=>{model=choice?.model||'';connectionId=choice?.connectionId||''}"/><span v-else class="assistant-composer-hint">Ctrl＋Enter 发送</span><button v-if="busy" type="button" class="control-button secondary" @click="assistant.cancel">停止</button><button v-else type="submit" class="control-button primary" data-testid="send-field-assistant" :disabled="!instruction.trim()||applying||taskActive" aria-label="发送给智能助笔"><StudioIcon name="arrow" :size="16"/>发送</button></footer>
            <label v-if="connectionId === 'local:llama-cpp'" class="local-output-budget">本次最大输出 <input v-model.number="maxTokensOverride" type="number" min="128" max="4096" step="128" :disabled="busy||taskActive" aria-label="本次本地最大输出"> tokens（建议 2048）</label>
            <ApplicationModelSettings v-if="!hasBook" :api="api"/>
          </form>
        </section>
      </section>
      <section v-show="mode==='checks'" class="assistant-mode-page assistant-check-page" data-testid="assistant-check-page"><slot v-if="hasBook" name="checks"/><p v-else class="field-empty">打开作品后，可在这里核对创作进度与内容一致性。</p></section>
      <section v-show="mode==='tasks'" class="assistant-mode-page assistant-task-page" data-testid="assistant-task-page"><section v-if="history.length" class="field-task-history"><header><b>输入内容的修改</b><small>按作品保留，候选不会自动写入。</small></header><button v-for="item in history" :key="item.id" type="button" :disabled="busy||applying" @click="assistant.viewTask(item);mode='agent'"><b>{{ item.target.label }}</b><span>{{ item.status==='completed'?'查看候选':item.status==='running'?'生成中':item.status==='cancelled'?'已停止':'未完成' }}</span><small>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</small></button></section><slot v-if="hasBook" name="tasks"/><p v-else-if="!history.length" class="field-empty">还没有助笔任务。</p></section>
    </div>
  </aside>
  </Teleport>
</template>

<style scoped>
.local-output-budget{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-size:.72rem;color:var(--muted);padding:.35rem 0}.local-output-budget input{width:5.2rem;padding:.3rem;border:1px solid var(--line);color:var(--ink);background:var(--surface)}
</style>
