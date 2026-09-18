<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CharacterLinesView } from '../../../../contracts/index'
import { characterStateDetails, projectCharacterAtlas } from '../services/character-atlas'

type AtlasChapter = { id: number; position: number; title: string }
const props = defineProps<{
  lines: CharacterLinesView
  chapters: AtlasChapter[]
  selectedId: string
  loading: boolean
  error: string
  throughPosition: number | null
}>()
const emit = defineEmits<{
  select: [characterId: string]
  openChapter: [chapterId: number]
  retry: []
  throughPosition: [value: number | null]
}>()
const query = ref('')
const location = ref('')
const throughPosition = computed(() => props.throughPosition)
const chapterIndex = computed(() => new Map(props.chapters.map(chapter => [chapter.id, chapter])))
const chapterChoices = computed(() => [...props.chapters].sort((a, b) => a.position - b.position))
const cards = computed(() => projectCharacterAtlas(props.lines, throughPosition.value, new Set(chapterIndex.value.keys())))
const locations = computed(() => [...new Set(cards.value.flatMap(card => card.locations))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
const visibleCards = computed(() => {
  const term = normalize(query.value)
  return cards.value.filter(card => (!term || normalize(card.name).includes(term)) && (!location.value || card.locations.includes(location.value)))
})
const selected = computed(() => visibleCards.value.find(card => card.characterId === props.selectedId) ?? null)
const latest = computed(() => selected.value?.latest ?? null)
const details = computed(() => characterStateDetails(latest.value))
const sourceChapter = computed(() => latest.value ? chapterIndex.value.get(latest.value.chapterId) : undefined)
const sourceLabel = computed(() => props.lines.source === 'sqlite-approved-facts' ? '已批准记录' : '已采用正文记录')
const cutoffLabel = computed(() => throughPosition.value === null ? '全书已记录范围' : `截至第 ${throughPosition.value} 章`)
const recordCount = computed(() => cards.value.reduce((count, card) => count + card.points.length, 0))

function changeThrough(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const position = Number(value)
  if (value === 'all') emit('throughPosition', null)
  else if (chapterChoices.value.some(chapter => chapter.position === position)) emit('throughPosition', position)
}
function resetFilters() { query.value = ''; location.value = '' }
function monogram(name: string) { return Array.from(name.trim()).slice(0, 1).join('') || '人' }

watch(() => props.lines.workItemId, () => {
  query.value = ''; location.value = ''
})
watch(locations, values => { if (location.value && !values.includes(location.value)) location.value = '' })
watch([() => props.selectedId, visibleCards, () => props.loading, () => props.error], ([id, , loading, error], previous) => {
  if (!id || loading || error || selected.value) return
  // An explicit selection from the outer chapter/person explorer wins over
  // local search filters; changing a filter itself still clears hidden detail.
  if (id !== previous?.[0] && cards.value.some(card => card.characterId === id)) resetFilters()
  else emit('select', '')
}, { immediate: true })
</script>

<template>
  <section class="character-atlas" :aria-busy="loading" aria-label="人物档案">
    <header class="atlas-heading">
      <span class="atlas-code">CHAPTER RECORDS / 章节记录</span>
      <div class="atlas-record-count" aria-live="polite"><b>{{ loading || error ? '—' : cards.length }}</b><span>人物 / {{ loading || error ? '—' : recordCount }} 条记录</span></div>
    </header>
    <p class="atlas-provenance">{{ cutoffLabel }} · {{ sourceLabel }}。这里只展示已有记录，可能承接此前状态；并非对当前正文的重新核对。</p>
    <div class="atlas-filters" role="group" aria-label="筛选人物档案">
      <label class="atlas-search"><span>查找人物</span><input v-assist-field="{ id: 'CharacterAtlas.query', read: () => query, write: value => { query = String(value) } }" v-model="query" type="search" data-testid="atlas-search" aria-label="搜索已记录的人物姓名" placeholder="输入人物姓名…" maxlength="160" :disabled="loading || !!error"></label>
      <label><span>故事进度</span><select v-assist-field="{id:'CharacterAtlas.throughPosition',read:()=>throughPosition===null?'all':throughPosition,write:value=>emit('throughPosition',value==='all'?null:Number(value))}" :value="throughPosition === null ? 'all' : throughPosition" data-testid="atlas-through-chapter" aria-label="人物记录截至章节" :disabled="loading || !!error" @change="changeThrough"><option value="all">全书已记录范围</option><option v-for="chapter in chapterChoices" :key="chapter.id" :value="chapter.position">截至第 {{ chapter.position }} 章</option></select></label>
      <label><span>曾记录地点</span><select v-assist-field="{ id: 'CharacterAtlas.location', read: () => location, write: value => { location = String(value) } }" v-model="location" data-testid="atlas-location-filter" aria-label="按所选进度内曾记录的地点筛选人物" :disabled="loading || !!error"><option value="">全部地点</option><option v-for="place in locations" :key="place" :value="place">{{ place }}</option></select></label>
    </div>

    <div v-if="loading" class="atlas-state" role="status"><span class="atlas-state-mark" aria-hidden="true">···</span><h3>正在读取人物记录</h3><p>保留原有正文，等待读取结果。</p></div>
    <div v-else-if="error" class="atlas-state atlas-error" role="alert"><span class="atlas-state-mark" aria-hidden="true">!</span><h3>人物档案暂时无法读取</h3><p>{{ error }}</p><button type="button" data-testid="atlas-retry" @click="emit('retry')">重新读取</button></div>
    <div v-else-if="!cards.length" class="atlas-state"><span class="atlas-state-mark" aria-hidden="true">人</span><h3>这个范围内还没有人物记录</h3><p v-if="throughPosition !== null">可以扩大截至章节，或选择全书。后文出现的人物不会提前显示。</p><p v-else>已有的人物事实或已采用正文状态会展示在这里；不会自动编造人物经历和关系。</p></div>
    <div v-else class="atlas-body">
      <section class="atlas-catalogue" aria-label="人物列表">
        <header class="atlas-section-heading"><span>人物索引</span><span>{{ visibleCards.length }} / {{ cards.length }}</span></header>
        <div v-if="!visibleCards.length" class="atlas-filter-empty" role="status"><h3>没有符合筛选的人物</h3><p>试试其他姓名或地点。</p><button type="button" @click="resetFilters">清除姓名与地点筛选</button></div>
        <div v-else class="atlas-cards" tabindex="0" aria-label="可滚动的人物卡片列表">
          <button v-for="card in visibleCards" :key="card.characterId" class="atlas-card" :class="{ selected: card.characterId === selectedId }" type="button" data-testid="atlas-card" :data-character-id="card.characterId" :aria-pressed="card.characterId === selectedId" @click="emit('select', card.characterId)">
            <span class="atlas-card-top"><span class="atlas-monogram" aria-hidden="true">{{ monogram(card.name) }}</span><span class="atlas-card-identity"><b>{{ card.name }}</b><small>{{ card.points.length }} 条记录 · {{ card.appearanceCount }} 章有出场</small></span><span class="atlas-card-arrow" aria-hidden="true">↗</span></span>
            <span class="atlas-card-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ card.latest?.location || '地点未记录' }}</span>
            <span class="atlas-card-foot"><span>最近节点 · 第 {{ card.latest?.chapterPosition }} 章</span><span>{{ card.latest?.present ? '出场' : '状态承接' }}</span></span>
          </button>
        </div>
      </section>

      <article v-if="selected && latest" class="atlas-dossier" data-testid="atlas-detail" :data-character-id="selected.characterId" :aria-label="`${selected.name}的人物档案`">
        <header class="atlas-dossier-heading"><span class="atlas-dossier-monogram" aria-hidden="true">{{ monogram(selected.name) }}</span><div><span class="atlas-code">人物状态记录 / DOSSIER</span><h3>{{ selected.name }}</h3><p>第 {{ latest.chapterPosition }} 章记录 · {{ latest.present ? '该节点有出场' : '承接此前状态' }}</p></div></header>
        <div class="atlas-detail-scroll" tabindex="0" aria-label="可滚动的人物记录详情">
          <div class="atlas-source-strip"><span>{{ latest.source === 'approved_fact' ? '来自作者批准的人物事实' : '来自作者已采用的正文状态' }}</span><span>{{ selected.appearanceCount }} 章有出场</span></div>
          <dl v-if="details.length" class="atlas-fields"><div v-for="field in details" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
          <p v-else class="atlas-no-fields">这条记录只确认人物存在或状态承接，没有补充地点、目标等字段。</p>
          <section class="atlas-chapter-source"><div><span class="atlas-code">记录所在章节</span><b>{{ sourceChapter ? `第 ${sourceChapter.position} 章 · ${sourceChapter.title || '未命名章节'}` : '该来源章节已不在当前目录中' }}</b></div><button v-if="sourceChapter" type="button" data-testid="atlas-open-chapter" :data-chapter-id="sourceChapter.id" @click="emit('openChapter', sourceChapter.id)">打开来源章节 <span aria-hidden="true">↗</span></button></section>
          <details class="atlas-source-details"><summary>查看记录来源与章节索引</summary><dl><div><dt>人物标识</dt><dd>{{ selected.characterId }}</dd></div><div><dt>来源记录</dt><dd>{{ latest.sourceId }}</dd></div></dl><ol><li v-for="(point, index) in selected.points" :key="`${point.sourceId}:${point.chapterId}:${index}`"><span>第 {{ point.chapterPosition }} 章</span><span>{{ point.present ? '记录出场' : '状态承接' }}</span></li></ol><p>来源标识用于追溯人物记录，不等同于时间线事件；这里不推断未记录的关系。</p></details>
        </div>
      </article>
      <div v-else class="atlas-unselected"><span aria-hidden="true">人</span><h3>选择一张人物卡</h3><p>查看这个故事进度下的状态记录和来源章节。</p><small>调整筛选后，不保留范围外人物的详情。</small></div>
    </div>
  </section>
</template>

<style scoped>
.character-atlas{display:flex;flex-direction:column;flex:1;min-inline-size:0;min-block-size:0;block-size:100%;overflow:hidden;container-type:inline-size;color:var(--color-ink);background:var(--color-surface);font:var(--archive-text-control,.875rem)/1.55 var(--sans);padding:clamp(.875rem,2vw,1.75rem);box-sizing:border-box}
.atlas-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex:none}.atlas-heading h2{margin:.25rem 0 0;font:600 clamp(1.375rem,2vw,1.875rem)/1.3 var(--serif)}.atlas-code{font:.625rem/1.5 var(--sans);letter-spacing:.1em;color:var(--color-muted)}.atlas-record-count{display:flex;align-items:baseline;gap:.5rem;white-space:nowrap}.atlas-record-count b{font:500 1.875rem/1.2 var(--serif)}.atlas-record-count span{font-size:.75rem;color:var(--color-muted)}.atlas-provenance{margin:.75rem 0 1rem;color:var(--color-muted);font-size:.75rem;max-inline-size:75em}
.atlas-filters{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr);gap:.75rem;flex:none;padding-block-end:1rem;border-bottom:1px solid var(--color-line)}.atlas-filters label{display:grid;gap:.375rem;min-inline-size:0;font-size:.75rem;color:var(--color-muted)}.atlas-filters input,.atlas-filters select{box-sizing:border-box;inline-size:100%;min-inline-size:0;min-block-size:2.5em;border:1px solid var(--color-line);border-radius:var(--radius-panel,.125rem);padding:.5em .75em;background:var(--color-paper);color:var(--color-ink);font:inherit;font-size:.8125rem}.atlas-filters :disabled{opacity:.6;cursor:wait}
.atlas-body{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.2fr);gap:1rem;min-inline-size:0;min-block-size:0;flex:1;padding-block-start:1rem;overflow:hidden}.atlas-catalogue,.atlas-dossier{display:flex;flex-direction:column;min-inline-size:0;min-block-size:0;overflow:hidden}.atlas-section-heading{display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0 .75rem;font-size:.75rem;color:var(--color-muted)}.atlas-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));align-content:start;gap:.75rem;min-block-size:0;overflow:auto;overscroll-behavior:contain;padding:.125rem .375rem .375rem .125rem;scrollbar-gutter:stable}
.atlas-card{position:relative;display:flex;flex-direction:column;gap:1rem;min-inline-size:0;padding:1rem;text-align:start;border:1px solid var(--color-line);border-radius:var(--radius-panel,.125rem);background:var(--color-paper);color:var(--color-ink);font:inherit;cursor:pointer;transition:border-color var(--duration-fast,140ms),background-color var(--duration-fast,140ms)}.atlas-card:hover{border-color:var(--color-jade)}.atlas-card.selected{background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink)}.atlas-card.selected::before{content:'';position:absolute;inset-inline-start:-1px;inset-block:.75rem auto;inline-size:.1875rem;block-size:1.5rem;background:var(--color-orange)}.atlas-card-top{display:flex;gap:.75rem;align-items:center;min-inline-size:0}.atlas-monogram{flex:none;display:grid;place-items:center;inline-size:2.5rem;aspect-ratio:1;border:1px solid currentColor;font:500 1.375rem/1 var(--serif);opacity:.8}.atlas-card-identity{display:grid;gap:.25rem;min-inline-size:0;flex:1}.atlas-card-identity b{font:600 1rem/1.4 var(--sans);overflow-wrap:anywhere}.atlas-card-identity small{font-size:.6875rem;opacity:.75}.atlas-card-arrow{align-self:start;font-size:1.125rem;opacity:.65}.atlas-card-location{display:flex;align-items:flex-start;gap:.375rem;font-size:.8125rem;overflow-wrap:anywhere}.atlas-card-location svg{flex:none;inline-size:1em;block-size:1em;margin-block-start:.25em;fill:none;stroke:currentColor;stroke-width:1.5}.atlas-card-foot{display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap;border-top:1px solid color-mix(in srgb,currentColor 20%,transparent);padding-block-start:.625rem;font-size:.625rem;opacity:.8}
.atlas-dossier{border:1px solid var(--color-line);background:var(--color-paper)}.atlas-dossier-heading{display:flex;align-items:center;gap:1rem;padding:1.25rem;border-bottom:1px solid var(--color-line);flex:none}.atlas-dossier-monogram{flex:none;display:grid;place-items:center;inline-size:3.5rem;aspect-ratio:1;background:var(--color-surface);border:1px solid var(--color-line);font:500 2rem/1 var(--serif)}.atlas-dossier-heading>div{min-inline-size:0}.atlas-dossier-heading h3{margin:.25rem 0;font:600 clamp(1.25rem,2vw,1.75rem)/1.35 var(--serif);overflow-wrap:anywhere}.atlas-dossier-heading p{margin:0;color:var(--color-muted);font-size:.6875rem}.atlas-detail-scroll{min-inline-size:0;min-block-size:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:1rem 1.25rem}.atlas-source-strip{display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap;border-inline-start:.1875rem solid var(--color-jade);padding-inline-start:.625rem;font-size:.6875rem;color:var(--color-muted);margin-block-end:.75rem}
.atlas-fields{margin:0}.atlas-fields>div{display:grid;grid-template-columns:4em minmax(0,1fr);gap:1rem;padding:.875rem 0;border-bottom:1px solid var(--color-line)}.atlas-fields dt{color:var(--color-muted);font-size:.75rem}.atlas-fields dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.875rem}.atlas-no-fields{color:var(--color-muted);font-size:.8125rem;line-height:1.8}.atlas-chapter-source{display:grid;gap:.75rem;padding-block:1rem}.atlas-chapter-source>div{display:grid;gap:.375rem}.atlas-chapter-source b{font-size:.8125rem;font-weight:500;overflow-wrap:anywhere}.atlas-chapter-source button{justify-self:start;display:flex;align-items:center;gap:1rem;background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink)}
.atlas-source-details{border-top:1px solid var(--color-line);padding-block-start:.75rem;font-size:.75rem}.atlas-source-details summary{cursor:pointer;color:var(--color-muted);padding-block:.375rem}.atlas-source-details dl{margin:.75rem 0}.atlas-source-details dl>div{display:grid;grid-template-columns:5em minmax(0,1fr);gap:.5rem;padding-block:.25rem}.atlas-source-details dt{color:var(--color-muted)}.atlas-source-details dd{margin:0;overflow-wrap:anywhere}.atlas-source-details ol{list-style:none;padding:0;margin:.5rem 0}.atlas-source-details li{display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--color-line)}.atlas-source-details p{color:var(--color-muted);line-height:1.8}
.atlas-state,.atlas-filter-empty,.atlas-unselected{display:flex;flex-direction:column;align-items:center;justify-content:center;min-inline-size:0;min-block-size:0;text-align:center;padding:clamp(1rem,3vw,2.5rem);gap:.75rem;overflow:auto}.atlas-state{flex:1}.atlas-state-mark,.atlas-unselected>span{display:grid;place-items:center;inline-size:3rem;aspect-ratio:1;border:1px solid var(--color-line);font:1.5rem/1 var(--serif);color:var(--color-muted)}.atlas-state h3,.atlas-filter-empty h3,.atlas-unselected h3{margin:0;font:600 1rem/1.5 var(--sans)}.atlas-state p,.atlas-filter-empty p,.atlas-unselected p{margin:0;color:var(--color-muted);font-size:.8125rem;max-inline-size:38em;overflow-wrap:anywhere}.atlas-unselected{border:1px dashed var(--color-line)}.atlas-unselected small{color:var(--color-muted);font-size:.6875rem}.atlas-error .atlas-state-mark{color:var(--color-danger);border-color:var(--color-danger)}
.character-atlas button:not(.atlas-card){min-block-size:2.5em;padding:.5em .875em;border:1px solid var(--color-line);border-radius:var(--radius-panel,.125rem);background:var(--color-surface);color:var(--color-ink);font:500 .8125rem/1.5 var(--sans);cursor:pointer}.character-atlas .atlas-chapter-source button{background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink)}.character-atlas :is(button,input,select,summary,[tabindex]):focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
@container (max-width:42rem){.atlas-heading{align-items:flex-start}.atlas-record-count{flex-direction:column;align-items:flex-end;gap:0}.atlas-body{grid-template-columns:minmax(0,.85fr) minmax(0,1fr);gap:.75rem}.atlas-card{padding:.75rem}.atlas-card-top{gap:.5rem}.atlas-monogram{inline-size:2rem}.atlas-card-arrow{display:none}.atlas-dossier-heading{padding:.875rem;gap:.75rem}.atlas-dossier-monogram{inline-size:2.5rem}.atlas-detail-scroll{padding:.75rem}.atlas-fields>div{grid-template-columns:minmax(0,1fr);gap:.375rem;padding:.625rem 0}}
@container (max-width:30rem){.atlas-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.atlas-search{grid-column:1/-1}.atlas-body{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(8rem,.75fr) minmax(0,1fr)}.atlas-cards{grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr))}.atlas-provenance{font-size:.6875rem}.atlas-dossier-heading{padding:.625rem .875rem}.atlas-dossier-heading h3{font-size:1.125rem}}
@media(prefers-reduced-motion:reduce){.atlas-card{transition:none}}
</style>
