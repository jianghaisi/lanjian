import { computed, reactive, shallowReactive, shallowRef, watch, nextTick, type ObjectDirective } from 'vue'
import { assistantFieldCatalog } from '../../../../contracts/assistant/assistant-field-catalog'
import type { FieldCandidate, FieldTarget, FieldValue } from '../../../../contracts/assistant/field-assistant-contracts'
import { sameFieldSnapshot, validateFieldValue } from '../../../../contracts/assistant/field-target'

export type FieldBinding = { id: string; read(): FieldValue; write(value: FieldValue): void; identity?(): unknown; label?(): string; options?(): FieldValue[]; reveal?(): Promise<boolean>; available?(): boolean }
type Entry = { key: string; binding: FieldBinding; target: FieldTarget; composing: boolean; alive: boolean; element?: HTMLElement; stop(): void }
export const fieldScope = reactive({ workItemId: null as string | null, pageId: 'library', pageLabel: '我的作品', epoch: 0 })
export const fieldRegistry = shallowReactive(new Map<string, Entry>())
export const fieldAssistantIntent = reactive({ key: '', serial: 0 })
const objectIds = new WeakMap<object, string>()
const adoptedSources = new Map<string,{candidateId:string;workItemId:string|null;fieldId:string}>()
export function fieldSourceIds(prefix:string) { return [...adoptedSources.values()].filter(source=>source.workItemId===fieldScope.workItemId&&source.fieldId.startsWith(prefix)).map(source=>source.candidateId).slice(-50) }
export function clearSavedFieldSources(ids:string[]) { for(const [key,source] of adoptedSources)if(ids.includes(source.candidateId))adoptedSources.delete(key) }
export function markFieldSource(candidate:FieldCandidate) { adoptedSources.set(candidate.target.fieldId,{candidateId:candidate.id,workItemId:candidate.target.workItemId,fieldId:candidate.target.fieldId}) }
export function clearFieldSource(candidate:FieldCandidate) { if(adoptedSources.get(candidate.target.fieldId)?.candidateId===candidate.id)adoptedSources.delete(candidate.target.fieldId) }
function identity(value: unknown): string {
  if (value && typeof value === 'object') { if(!objectIds.has(value))objectIds.set(value,crypto.randomUUID());return objectIds.get(value)! }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'form'
}
export function updateFieldScope(workItemId: string | null, pageId: string, pageLabel: string) {
  if(fieldScope.workItemId !== workItemId){fieldScope.epoch++;fieldAssistantIntent.key='';adoptedSources.clear()}
  Object.assign(fieldScope,{workItemId,pageId,pageLabel})
}
export function requestFieldAssistant(key: string) { fieldAssistantIntent.key=key;fieldAssistantIntent.serial++ }
export const availableFields = computed(() => [...fieldRegistry.values()].filter(e => e.alive && e.target.workItemId === fieldScope.workItemId && (!e.binding.available || e.binding.available()) && (!e.element || e.element.isConnected && !e.element.matches(':disabled,[readonly]') && e.element.getClientRects().length > 0)))

export function registerAssistantField(binding: FieldBinding, element?: HTMLElement, persistent = false) {
  const spec=assistantFieldCatalog[binding.id]
  if(!spec)throw new Error(`Unregistered assistant field: ${binding.id}`)
  const key=crypto.randomUUID(), session=crypto.randomUUID()
  const descriptor=shallowRef(binding)
  let lastIdentity='', instanceId=crypto.randomUUID(), revision=0, lastValue: FieldValue | undefined
  const entry: Entry = {key,binding,target:null as unknown as FieldTarget,composing:false,alive:true,element,stop:()=>{}}
  const stop=watch(() => [descriptor.value,descriptor.value.read(),descriptor.value.identity?.(),fieldScope.workItemId,fieldScope.epoch,fieldScope.pageId,descriptor.value.options?.(),descriptor.value.label?.()], () => {
    binding=descriptor.value;entry.binding=binding
    const value=binding.read(), owner=identity(binding.identity?.()), nextIdentity=`${fieldScope.epoch}:${owner}`
    if(nextIdentity!==lastIdentity){lastIdentity=nextIdentity;instanceId=crypto.randomUUID();revision=0;lastValue=undefined}
    if(value!==lastValue){revision++;lastValue=value}
    const options=binding.options?.()
    const entity=binding.identity?.()
    const name=entity && typeof entity==='object' ? String((entity as {name?:string;title?:string}).name || (entity as {title?:string}).title || '').slice(0,60) : ''
    const label=binding.label?.() || `${spec.label}${name ? ` · ${name}` : ''}`
    entry.target={fieldId:binding.id,instanceId,editorSessionId:session,workItemId:fieldScope.workItemId,pageId:persistent?'profile':fieldScope.pageId,label:label.slice(0,240),revision,value,...(options?{options}: {})}
    fieldRegistry.set(key,{...entry})
  },{immediate:true,flush:'sync'})
  entry.stop=()=>{entry.alive=false;stop();fieldRegistry.delete(key)}
  return {key,dispose:entry.stop,composing(value:boolean){entry.composing=value;fieldRegistry.set(key,{...entry})},update(next:FieldBinding){descriptor.value=next}}
}
export function fieldIsCurrent(key: string, target: FieldTarget) {
  const entry=fieldRegistry.get(key)
  return Boolean(entry?.alive && !entry.composing && availableFields.value.some(e=>e.key===key) && sameFieldSnapshot(entry.target,target))
}
export async function applyFieldDraft(key: string, candidate: FieldCandidate) {
  let entry=fieldRegistry.get(key)
  if (!entry || !fieldIsCurrent(key,candidate.target)) throw new Error('这个输入内容已变化，请基于当前草稿重新生成。')
  if(entry.binding.reveal && !await entry.binding.reveal()) throw new Error('当前页面有待处理的修改，未切换目标。')
  entry=fieldRegistry.get(key)
  if(!entry || !fieldIsCurrent(key,candidate.target))throw new Error('目标已变化，请重新选择。')
  validateFieldValue(entry.target,candidate.after)
  entry.binding.write(candidate.after)
  await nextTick()
  const applied=fieldRegistry.get(key)
  if(!applied || applied.target.instanceId!==candidate.target.instanceId || (applied.target.value===candidate.before && candidate.after!==candidate.before))throw new Error('输入未能回填，请检查本页提示后重试。')
  return {key,before:candidate.before,after:applied.target.value,target:{...applied.target}}
}
export function undoFieldDraft(change: {key:string;before:FieldValue;after:FieldValue;target:FieldTarget}) {
  const entry=fieldRegistry.get(change.key)
  if(!entry || !fieldIsCurrent(change.key,change.target) || entry.binding.read()!==change.after)throw new Error('采用后已有新的编辑，请使用输入框或编辑器的撤销。')
  entry.binding.write(change.before)
}

type Native = HTMLElement
const attached=new WeakMap<HTMLElement,{update(next:FieldBinding):void;dispose():void}>()
export const assistFieldDirective: ObjectDirective<Native,FieldBinding> = {
  mounted(el,{value}) {
    // The assistant is optional infrastructure. A missed reviewed capability
    // must never prevent the underlying author form or workspace from mounting.
    // Static/source tests still fail the build for this developer error.
    if (!assistantFieldCatalog[value.id]) {
      el.dataset.assistantFieldError = 'unregistered'
      return
    }
    // Read only enum option metadata from this explicitly registered control; its value is from the getter.
    const normalize=(binding:FieldBinding):FieldBinding=>({...binding,options:el instanceof HTMLSelectElement?()=>[...el.options].filter(o=>!o.disabled).map(o=>(o as HTMLOptionElement & {_value?:FieldValue})._value??o.value):binding.options})
    const registration=registerAssistantField(normalize(value),el)
    el.dataset.assistantField=value.id
    const focus=()=>{fieldAssistantIntent.key=registration.key}
    const keydown=(event:Event)=>{const key=event as KeyboardEvent;if(key.altKey&&key.key==='Enter'){key.preventDefault();requestFieldAssistant(registration.key)}}
    const start=()=>registration.composing(true),end=()=>queueMicrotask(()=>registration.composing(false))
    el.addEventListener('focusin',focus);el.addEventListener('keydown',keydown);el.addEventListener('compositionstart',start);el.addEventListener('compositionend',end)
    el.setAttribute('aria-keyshortcuts',`${el.getAttribute('aria-keyshortcuts')||''} Alt+Enter`.trim())
    attached.set(el,{update:next=>registration.update(normalize(next)),dispose(){registration.dispose();el.removeEventListener('focusin',focus);el.removeEventListener('keydown',keydown);el.removeEventListener('compositionstart',start);el.removeEventListener('compositionend',end)}})
  },
  updated(el,{value}){
    if (!assistantFieldCatalog[value.id]) {
      attached.get(el)?.dispose()
      attached.delete(el)
      el.dataset.assistantFieldError = 'unregistered'
      return
    }
    delete el.dataset.assistantFieldError
    attached.get(el)?.update(value)
  },
  beforeUnmount(el){attached.get(el)?.dispose();attached.delete(el)}
}
