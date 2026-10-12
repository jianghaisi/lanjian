<script setup lang="ts">
import { computed } from 'vue'
import type { ContextCharacterStateView, ContextFactEvidence, ContextFactPackView, ContextMaterialEvidence } from '../../../../contracts/index'
import { contextEvidenceKey, contextMaterialEvidenceKey } from '../../../../contracts/assistant/context-evidence-key'

const props = defineProps<{ pack: ContextFactPackView; pinnedEvidenceKeys?: string[]; excludedEvidenceKeys?: string[] }>()
const emit = defineEmits<{ pinEvidence: [key: string]; excludeEvidence: [key: string] }>()
const recentSummaries = computed(() => props.pack.structured.recentApprovedSummaries?.length
  ? props.pack.structured.recentApprovedSummaries
  : props.pack.structured.latestApprovedSummary ? [props.pack.structured.latestApprovedSummary] : [])
const usesSqliteChunks = computed(() => props.pack.evidence.some((item) => item.sourceType === 'document_chunk'))

function characterFacts(snapshot: ContextCharacterStateView) {
  return [
    snapshot.location ? `地点：${snapshot.location}` : '',
    snapshot.injury ? `伤势：${snapshot.injury}` : '',
    snapshot.relationships?.length ? `关系：${snapshot.relationships.join('；')}` : '',
    snapshot.knowledge?.length ? `已知：${snapshot.knowledge.join('；')}` : '',
    snapshot.possession ? `物品：${snapshot.possession}` : '',
    snapshot.goal ? `目标：${snapshot.goal}` : '',
    snapshot.power ? `实力：${snapshot.power}` : '',
    snapshot.vitality ? `生死：${snapshot.vitality === 'alive' ? '存活' : '死亡'}` : ''
  ].filter(Boolean)
}

function displayJson(value: string) {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  } catch { return value }
}

function evidencePinned(item: ContextFactEvidence) {
  return Boolean(props.pinnedEvidenceKeys?.includes(contextEvidenceKey(item)))
}

function materialPinned(item: ContextMaterialEvidence) {
  return Boolean(props.pinnedEvidenceKeys?.includes(contextMaterialEvidenceKey(item)))
}

function eventPhaseLabel(phase: ContextFactPackView['structured']['canonicalEvents'][number]['phase']) {
  if (phase === 'planned') return '后续计划'
  if (phase === 'realized') return '已实现'
  if (phase === 'deviated') return '已偏离计划'
  return '阶段未标注'
}
</script>

<template>
  <details class="context-fact-pack" data-testid="context-fact-pack">
    <summary>
      <span><b>事实与前文</b></span>
      <em v-if="recentSummaries.length || pack.structured.canonicalEvents.length || pack.structured.characterSnapshots.length || pack.structured.characterAliases.length || pack.structured.approvedFacts.length || pack.evidence.length || pack.materials?.length">摘要 {{ recentSummaries.length }} · 事件 {{ pack.structured.canonicalEvents.length }} · 事实 {{ pack.structured.approvedFacts.length }} · 人物 {{ pack.structured.characterSnapshots.length }} · 称呼 {{ pack.structured.characterAliases.length }} · 前文 {{ pack.evidence.length }} · 素材 {{ pack.materials?.length || 0 }}</em>
      <em v-else>暂无补充依据</em>
      <small v-if="pinnedEvidenceKeys?.length || excludedEvidenceKeys?.length" class="context-preference-count">本书固定 {{ pinnedEvidenceKeys?.length || 0 }} · 排除 {{ excludedEvidenceKeys?.length || 0 }}</small>
    </summary>
    <div class="context-source-ledger">
      <section data-context-source="chapter-summary">
        <header><span><b>近期章节承接</b><small>作者确认的章末摘要；从近到远，正文变更后自动失效</small></span><em>{{ recentSummaries.length ? `${recentSummaries.length} 章` : '—' }}</em></header>
        <article v-for="summary in recentSummaries" :key="summary.bodyVersionId" :data-summary-chapter="summary.chapterId">
          <div><b>第 {{ summary.chapterId }} 章摘要</b><small>{{ summary.bodyVersionId.slice(0, 10) }}</small></div>
          <p>{{ summary.content }}</p>
          <footer>已绑定正文版本；仅用于承接，不会覆盖章卡、事件或正式事实。</footer>
        </article>
        <p v-if="!recentSummaries.length" class="context-source-empty">此前尚无已确认且仍有效的章末摘要。</p>
      </section>
      <section data-context-source="events">
        <header><span><b>正式事件</b><small>只列本章已分配事件<template v-if="pack.structured.eventApprovedRevision"> · 批准修订 {{ pack.structured.eventApprovedRevision.slice(0, 10) }}</template></small></span><em>{{ pack.structured.canonicalEvents.length }}</em></header>
        <article v-for="event in pack.structured.canonicalEvents" :key="event.id" :data-event-source-id="event.id">
          <div><b>{{ event.time }} · {{ event.location }}</b><small>{{ event.provenance }} · {{ eventPhaseLabel(event.phase) }} · {{ (event.versionId || event.id).slice(0, 10) }}</small></div>
          <p>{{ event.characters.join('、') }}｜{{ event.event }}<template v-if="event.result"> → {{ event.result }}</template></p>
          <footer v-if="event.evidenceRefs.length">证据：{{ event.evidenceRefs.map((item) => item.sourceId).join('、') }}</footer>
        </article>
        <p v-if="!pack.structured.canonicalEvents.length" class="context-source-empty">本章尚未分配正式事件。</p>
      </section>
      <section data-context-source="characters">
        <header><span><b>章前人物状态</b><small>SQLite 模式只由本章之前的已批准事实重建</small></span><em>{{ pack.structured.characterSnapshots.length }}</em></header>
        <article v-for="snapshot in pack.structured.characterSnapshots" :key="snapshot.characterId" :data-character-source-id="snapshot.characterId">
          <div><b>{{ snapshot.name }}</b><small>截至第 {{ snapshot.throughChapter }} 章 · {{ snapshot.lastEventId.slice(0, 10) }}</small></div>
          <p>{{ characterFacts(snapshot).join('｜') || '仅确认此前出场' }}</p>
        </article>
        <p v-if="!pack.structured.characterSnapshots.length" class="context-source-empty">此前尚无已批准的人物变化；不影响继续写作。</p>
      </section>
      <section data-context-source="character-aliases">
        <header><span><b>人物称呼</b><small>作者确认的别名；只用于指代归一，不增加关系或设定</small></span><em>{{ pack.structured.characterAliases.length }}</em></header>
        <article v-for="item in pack.structured.characterAliases" :key="item.characterId" :data-character-alias-id="item.characterId">
          <div><b>{{ item.canonicalName }}</b><small>正式别名</small></div>
          <p>{{ item.aliases.join('、') }}</p>
        </article>
        <p v-if="!pack.structured.characterAliases.length" class="context-source-empty">尚未为本书保存人物别名。</p>
      </section>
      <section data-context-source="approved-facts">
        <header><span><b>作者批准事实</b><small>仅来自当前章之前已逐条确认的候选</small></span><em>{{ pack.structured.approvedFacts.length }}</em></header>
        <article v-for="fact in pack.structured.approvedFacts" :key="fact.id" :data-approved-fact-id="fact.id" :class="{ 'source-changed': !fact.sourceCurrent }">
          <div><b>{{ fact.normalizedKey }}</b><small>{{ fact.importance === 'high' ? '关键' : fact.importance === 'medium' ? '常规' : '补充' }} · {{ fact.id.slice(0, 10) }}</small></div>
          <p>{{ fact.predicate }}：{{ displayJson(fact.objectJson) }}</p>
          <footer>来源第 {{ fact.sources.map((source) => source.chapterId).join('、') || '—' }} 章<template v-if="!fact.sourceCurrent"> · 来源正文后来变更，请谨慎核对</template></footer>
        </article>
        <p v-if="!pack.structured.approvedFacts.length" class="context-source-empty">此前章节尚无经过作者批准的事实。</p>
      </section>
      <section data-context-source="manuscript">
        <header><span><b>前文逐字证据</b><small>{{ usesSqliteChunks ? 'SQLite 从全部有效前文筛选；版本可追溯，不高于正式事实' : '正文版本可追溯，不高于正式事实' }}</small></span><em>预算 {{ pack.budget.usedCharacters }}/{{ pack.budget.maxCharacters }}</em></header>
        <ol v-if="pack.evidence.length">
          <li v-for="item in pack.evidence" :key="contextEvidenceKey(item)" :data-evidence-chapter="item.chapterId">
            <header><b>第 {{ item.chapterPosition }} 章 · {{ item.chapterTitle }}</b><small>{{ item.manuscriptRevision.slice(0, 8) }}<template v-if="item.sourceType === 'document_chunk'"> · 分块 {{ Number(item.chunkOrdinal) + 1 }} · 约 {{ item.tokenEstimate }} tokens</template></small></header>
            <p>{{ item.excerpt }}</p>
            <footer><span>{{ item.reason }}</span><span class="context-evidence-actions"><button type="button" :class="{ pinned: evidencePinned(item) }" :aria-pressed="evidencePinned(item)" :data-evidence-key="contextEvidenceKey(item)" @click="emit('pinEvidence', contextEvidenceKey(item))">{{ evidencePinned(item) ? '已固定' : '固定' }}</button><button type="button" :data-exclude-evidence-key="contextEvidenceKey(item)" @click="emit('excludeEvidence', contextEvidenceKey(item))">不再引用</button></span></footer>
          </li>
        </ol>
        <p v-else class="context-fact-empty">当前章没有命中需要补充的远距正文证据；正式事件与人物状态仍会正常装配。</p>
      </section>
      <section data-context-source="materials">
        <header><span><b>相关素材资料</b><small>{{ pack.materialBudget?.searchMode === 'sqlite' ? 'SQLite 当前作品有界检索' : '旧项目文件兼容检索' }}；最低权威，不会自动变成作品事实</small></span><em>预算 {{ pack.materialBudget?.usedCharacters || 0 }}/{{ pack.materialBudget?.maxCharacters || 0 }}</em></header>
        <ol v-if="pack.materials?.length">
          <li v-for="item in pack.materials" :key="contextMaterialEvidenceKey(item)" :data-material-source-id="item.sourceId">
            <header><b>{{ item.title }}</b><small>{{ item.provider }} · {{ item.sourceId.slice(0, 10) }}</small></header>
            <p>{{ item.excerpt }}</p>
            <p v-if="item.userNotes" class="context-material-notes">作者整理：{{ item.userNotes }}</p>
            <footer><span>{{ item.reason }}<template v-if="item.url"> · <a :href="item.url" target="_blank" rel="noreferrer">查看来源</a></template></span><span class="context-evidence-actions"><button type="button" :class="{ pinned: materialPinned(item) }" :aria-pressed="materialPinned(item)" :data-material-evidence-key="contextMaterialEvidenceKey(item)" @click="emit('pinEvidence', contextMaterialEvidenceKey(item))">{{ materialPinned(item) ? '已固定' : '固定' }}</button><button type="button" :data-exclude-material-key="contextMaterialEvidenceKey(item)" @click="emit('excludeEvidence', contextMaterialEvidenceKey(item))">不再引用</button></span></footer>
          </li>
        </ol>
        <p v-else class="context-fact-empty">当前章没有命中资料卡；不会为了填满上下文而加入无关素材。</p>
      </section>
    </div>
    <footer v-if="pack.budget.omittedEvidenceCount || pack.materialBudget?.omittedEvidenceCount">另有 {{ pack.budget.omittedEvidenceCount }} 条前文、{{ pack.materialBudget?.omittedEvidenceCount || 0 }} 条素材因预算或优先级未装入。</footer>
  </details>
</template>
