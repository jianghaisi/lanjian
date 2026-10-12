<script setup lang="ts">
import { ref } from 'vue'
import { useProseEventSettlement } from '../composables/use-prose-event-settlement'
const props=defineProps<{workItemId:string;chapterId:number;body:string;title:string;disabled?:boolean}>()
const emit=defineEmits<{saved:[]}>()
const {open,pending,message,page,preview,form,replaces,dirty,composing,choices,withdrawReasons,uncertain,locked,fresh,candidates,activeTasks,
 toggle,refresh,recover,reset,edit,review,change,addQuote,save,choosePlan,prepare,withdraw,commit,start,stop}=useProseEventSettlement(props,()=>emit('saved'))
const sourceText=ref<HTMLTextAreaElement>()
const states={'current':'本版有效','needs-review':'需要复核','withdrawn':'本版不再成立','superseded':'历史版本','untracked':'尚未按正文核对'}
const outcomes={'new':'新增事件','realizes':'实现计划','deviates-from':'偏离计划'}
const fieldNames={time:'时间',characters:'人物',location:'地点',event:'事件',result:'结果'}
</script>
<template>
<section class="settlement-panel" data-testid="prose-event-settlement" aria-label="本章正文事件核对">
 <button type="button" class="settlement-toggle" :aria-expanded="open" @click="toggle">核对本章事件 · {{open?'收起':'展开'}}</button>
 <div v-if="open" class="settlement-content">
  <p>从已保存正文核对实际发生的事件。候选与计划分别保留，确认后才成为当前事实。</p>
  <p v-if="disabled || (page && (page.source.body!==body || page.source.title!==title))" role="status">正文有改动或正在处理，请先完成保存，再刷新核对。</p>
  <p v-if="message" role="status" class="settlement-message">{{message}}</p>
  <div class="settlement-actions">
   <button type="button" :disabled="pending" @click="refresh">刷新依据</button>
   <button type="button" :disabled="locked || !page?.source.body.trim() || activeTasks.length>0" @click="start">用审校模型提取候选</button>
   <button v-if="uncertain" type="button" :disabled="pending" @click="recover">查询上次确认回执</button>
  </div>
  <template v-if="page">
   <details><summary>本版正文与计划依据</summary>
    <p>正文版本：{{page.source.basis.bodyVersionId}}</p>
    <template v-if="page.source.contract">
     <p>以下保留章契确认时的事件依据。版本变化或记录缺失时，请对照当前计划核对。</p>
     <p v-if="!page.source.contractEvents.length">该章契未记录关联事件。</p>
     <article v-for="event in page.source.contractEvents" :key="event.eventId" data-testid="settlement-contract-event">
      <b>{{event.content?.event||'原依据内容不可用'}} · {{event.current?'仍为当前关联版本':'已变化或缺少确切版本'}}</b>
      <template v-if="event.content"><p>{{event.content.time}} · {{event.content.characters.join('、')}} · {{event.content.location}}</p><p>{{event.content.result}}</p></template>
      <small>确认时版本：{{event.versionId||'旧记录未保存确切版本，不以当前内容回填'}}</small>
     </article>
    </template>
    <p v-else>没有已确认章契，按当前关联计划核对；手写稿仍可新增事件。</p>
    <h4>当前可关联的计划</h4>
    <p v-if="!page.source.plans.length">本章没有当前有效的关联计划。</p>
    <article v-for="plan in page.source.plans" :key="plan.eventId"><b>{{plan.content.event}}</b><p>{{plan.content.time}} · {{plan.content.characters.join('、')}} · {{plan.content.location}}</p><p>{{plan.content.result}}</p><small>计划版本：{{plan.versionId}}</small></article>
   </details>
   <div v-if="page.tasks.length" class="settlement-tasks">
    <p v-for="task in page.tasks" :key="task.id">提取任务：{{task.status==='succeeded'?'已完成':task.status==='failed'?'失败':task.status==='cancelled'?'已停止':task.status==='interrupted'?'已中断，可重新提取':'进行中'}} · {{task.drafts.length}} 项候选
     <button v-if="activeTasks.some(t=>t.id===task.id)" type="button" :disabled="pending" @click="stop(task.id)">停止提取</button><span v-if="task.error">{{task.error}}</span>
    </p>
    <details v-for="task in page.tasks.filter(t=>t.rawOutput!==undefined)" :key="task.id"><summary>查看提取原始输出 · {{task.id}}</summary><pre class="settlement-raw">{{task.rawOutput}}</pre></details>
   </div>
   <details open class="settlement-editor">
    <summary>{{replaces?'复核原实际事件':'手工填写或编辑候选'}}{{dirty?' · 未保存':''}}</summary>
    <p>未知要素可先留空。你填写或修改的字段会标为作者补充；确认前必须补齐四要素并选择原句。</p>
    <fieldset :disabled="locked && !composing" @compositionstart="composing=true" @compositionend="composing=false; change()">
     <label>时间<input v-model="form.fields.time" maxlength="500" @input="change('time')"></label>
     <label>人物<input :value="form.fields.characters.join('、')" maxlength="20000" @input="form.fields.characters=($event.target as HTMLInputElement).value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean); change('characters')"></label>
     <label>地点<input v-model="form.fields.location" maxlength="500" @input="change('location')"></label>
     <label>事件<textarea v-model="form.fields.event" rows="2" maxlength="20000" @input="change('event')"></textarea></label>
     <label>结果<textarea v-model="form.fields.result" rows="2" maxlength="20000" @input="change('result')"></textarea></label>
    </fieldset>
    <small v-if="form.supplements.length">作者补充：{{form.supplements.map(f=>fieldNames[f]).join('、')}}</small>
    <label>已保存正文（选中连续原句）<textarea ref="sourceText" :value="page.source.body" readonly rows="6" class="settlement-source" aria-label="已保存正文原句"></textarea></label>
    <button type="button" :disabled="locked" @click="addQuote(sourceText)">将选中文字作为证据</button>
    <blockquote v-for="(quote,index) in form.quotes" :key="index">{{quote.quote}}<button type="button" :disabled="locked" @click="form.quotes.splice(index,1); change()">移除引文</button></blockquote>
    <div class="settlement-actions"><button type="button" :disabled="locked" @click="save">保存候选</button><button type="button" :disabled="pending || composing" @click="reset">填写另一项</button></div>
   </details>
   <section aria-label="已保存的事件候选">
    <h4>已保存候选 · {{candidates.length}}</h4>
    <p v-if="!candidates.length">还没有候选，可以手工填写或主动提取。</p>
    <article v-for="draft in candidates" :key="draft.id" class="settlement-candidate" data-testid="settlement-candidate">
     <label><input v-model="choices[draft.id].selected" type="checkbox" :disabled="locked || draft.source.fingerprint!==fresh || !!uncertain" @change="preview=null">选择：{{draft.fields.event||'事件待补充'}}</label>
     <p>{{draft.fields.time||'时间待补'}} · {{draft.fields.characters.join('、')||'人物待补'}} · {{draft.fields.location||'地点待补'}}</p>
     <p v-if="draft.source.fingerprint!==fresh">依据已变化，请编辑并重选本版原句。</p>
     <p v-if="choices[draft.id].replaces">将沿用原实际事件身份，追加复核版本。</p>
     <details><summary>引文与作者补充</summary><blockquote v-for="(q,index) in draft.quotes" :key="index">{{q.quote}}</blockquote><small>作者补充：{{draft.supplements.map(f=>fieldNames[f]).join('、')||'无'}}</small></details>
     <label>实际事件身份<select v-model="choices[draft.id].replaces" :disabled="locked" @change="preview=null"><option :value="undefined">创建新实际事件</option><option v-for="h in page.history.filter(h=>h.status.state!=='superseded')" :key="h.decision.id" :value="h.decision.id">复核：{{h.fields.event}}</option></select></label>
     <label>结算方式<select v-model="choices[draft.id].outcome" :disabled="locked" @change="preview=null"><option value="new">新增事件</option><option value="realizes" :disabled="!page.source.plans.length">实现计划</option><option value="deviates-from" :disabled="!page.source.plans.length">偏离计划</option></select></label>
     <div v-if="choices[draft.id].outcome!=='new'"><label v-for="plan in page.source.plans" :key="plan.eventId"><input type="checkbox" :disabled="locked" :checked="choices[draft.id].plans.some(p=>p.eventId===plan.eventId)" @change="choosePlan(draft.id,plan.eventId,($event.target as HTMLInputElement).checked)"> {{plan.content.event}}</label></div>
     <button type="button" :disabled="locked" @click="edit(draft)">编辑此候选</button>
    </article>
    <button type="button" :disabled="locked || dirty || !!uncertain || !Object.values(choices).some(c=>c.selected)" @click="prepare">预览所选结算（最多 20 项）</button>
   </section>
   <section v-if="preview" class="settlement-preview" data-testid="settlement-preview">
    <h4>确认前核对</h4><p v-if="preview.withdrawal">本版不再成立：{{preview.withdrawal}}</p>
    <article v-for="(item,index) in preview.items" :key="index"><b>{{outcomes[item.outcome]}}：{{item.fields.event}}</b><p>{{item.fields.time}} · {{item.fields.characters.join('、')}} · {{item.fields.location}}</p><p>{{item.fields.result}}</p>
     <p v-if="item.replaces">复核原事件：{{item.replaces}}</p><p v-for="plan in item.plans" :key="plan.eventId">关联计划：{{plan.content.event}}（{{plan.content.time}} · {{plan.content.location}}）</p>
     <blockquote v-for="(q,i) in item.quotes" :key="i">{{q.quote}}</blockquote>
    </article>
    <p>请判断原句是否支持事件及其与计划的关系。逐字匹配只验证出处。</p>
    <button type="button" :disabled="locked || !!uncertain" @click="commit">确认保存结算</button>
   </section>
   <details :open="page.history.some(h=>h.status.state==='needs-review')"><summary>结算与复核记录 · {{page.history.length}}</summary>
    <article v-for="history in page.history" :key="history.decision.id" class="settlement-history" data-testid="settlement-history">
     <b>{{history.fields.event}} · {{states[history.status.state]}}</b><p>{{history.status.reason}}</p><p>{{history.decision.createdAt}}</p>
     <details><summary>历史证据</summary><p>正文版本：{{history.decision.source.bodyVersionId}}</p><blockquote v-for="(q,i) in history.decision.quotes" :key="i">{{q.quote}}</blockquote></details>
     <template v-if="history.status.state!=='superseded'">
      <button type="button" :disabled="locked || !!uncertain" @click="review(history)">按本版重新核对</button>
      <template v-if="history.decision.kind!=='withdraw'"><label>不再成立的理由<textarea v-model="withdrawReasons[history.decision.id]" rows="2" maxlength="2000" :disabled="locked"></textarea></label>
       <button type="button" :disabled="locked || !withdrawReasons[history.decision.id]?.trim() || !!uncertain" @click="withdraw(history)">预览“本版不再成立”</button></template>
     </template>
    </article>
   </details>
  </template>
 </div>
</section>
</template>
<style scoped>
.settlement-panel{border:1px solid var(--color-line);border-radius:10px;background:var(--color-surface);color:var(--color-ink);min-width:0;margin:12px 0}
.settlement-toggle{width:100%;text-align:left;padding:12px;font-weight:650;background:transparent;color:inherit;border:0;border-radius:10px;cursor:pointer}
.settlement-content{display:grid;gap:12px;padding:0 12px 14px;min-width:0;overflow-wrap:anywhere}
.settlement-content p{font-size:12px;line-height:1.65;margin:6px 0}
.settlement-content label{display:grid;gap:5px;font-size:12px;margin:8px 0}
.settlement-content label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:7px}
.settlement-content input:not([type=checkbox]),.settlement-content textarea,.settlement-content select{width:100%;box-sizing:border-box;background:var(--color-surface);color:var(--color-ink);border:1px solid var(--color-line);border-radius:6px;padding:8px;min-width:0;font:inherit}
.settlement-content textarea{resize:vertical;line-height:1.65}
.settlement-content button{border:1px solid var(--color-line);border-radius:6px;padding:6px 9px;background:var(--color-surface);color:var(--color-ink);font-size:12px}
.settlement-content button:disabled{opacity:.5}
.settlement-actions{display:flex;gap:8px;flex-wrap:wrap}
.settlement-content fieldset{border:0;padding:0;margin:0;min-width:0}
.settlement-content article{border-bottom:1px solid var(--color-line);padding:10px 0}
.settlement-content blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid var(--color-line);white-space:pre-wrap;font-size:12px;line-height:1.7}
.settlement-content small{font-size:11px;color:var(--color-muted)}
.settlement-content summary{cursor:pointer;font-size:12px;line-height:1.8}
.settlement-message,.settlement-preview{border:1px solid var(--color-line);padding:10px;border-radius:6px}
.settlement-source{max-height:240px}
.settlement-raw{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;font-size:11px}
.settlement-content :focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
</style>
