<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { timelineEventTitle } from '../timeline-workbench'

type Entry = { id: string; title?: string; time: string; characters: string | string[]; location: string; event: string; result: string }
type Kind = 'formal' | 'direct' | 'candidate'
type Field = 'title' | 'time' | 'characters' | 'location' | 'event' | 'result'
const props = defineProps<{
  formal: Entry[]; direct: Entry[]; candidates: Entry[]; selected: string; busy: boolean; issue: boolean
  placements: Array<{ eventId: string; chapterId: number }>; chapters: Array<{ id: number; title: string; position?: number }>
}>()
const emit = defineEmits<{
  select: [kind: Kind, id: string]; update: [kind: Kind, id: string, field: Field, value: string]
  add: []; save: []; review: []; map: [location: string]; foreshadows: []; chapter: [id: number]
  move: [index: number, direction: number]; remove: [index: number]; adopt: [item: Entry]; discard: [id: string]
}>()
const query = ref('')
const origin = ref('all')
const editing = ref(false)
const dossierScroll = ref<HTMLElement>()
const rows = computed(() => [
  ...(!props.issue ? props.formal : []).map(item => ({ kind: 'formal' as Kind, item })),
  ...props.direct.map(item => ({ kind: 'direct' as Kind, item }))
])
const matches = (item: Entry) => [item.title, item.time, item.characters, item.location, item.event, item.result].join(' ').toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
const visible = computed(() => rows.value.filter(row => (origin.value === 'all' || origin.value === row.kind) && matches(row.item)))
const selectedRow = computed(() => [...rows.value, ...props.candidates.map(item => ({ kind: 'candidate' as Kind, item }))].find(row => `${row.kind}:${row.item.id}` === props.selected) ?? null)
const selectedChapter = computed(() => {
  if (selectedRow.value?.kind !== 'formal') return null
  const placement = props.placements.find(item => item.eventId === selectedRow.value?.item.id)
  return props.chapters.find(item => item.id === placement?.chapterId) ?? null
})
const directIndex = computed(() => props.direct.findIndex(item => item.id === selectedRow.value?.item.id))
const sourceLabel = (kind: Kind) => ({ formal: '资料确认', direct: '作者事件', candidate: 'AI 候选 · 未采用' })[kind]
const characters = (item: Entry) => Array.isArray(item.characters) ? item.characters.join('、') : item.characters
const fields: Array<{ key: Field; label: string; limit: number }> = [
  { key: 'title', label: '事件标题', limit: 200 }, { key: 'time', label: '时间或阶段', limit: 200 },
  { key: 'characters', label: '人物', limit: 1000 }, { key: 'location', label: '地点', limit: 500 }
]
watch(() => props.selected, async () => {
  editing.value = selectedRow.value?.kind === 'candidate' || (selectedRow.value?.kind === 'direct' && !selectedRow.value.item.event)
  await nextTick()
  if (dossierScroll.value) dossierScroll.value.scrollTop = 0
}, { immediate: true })
function update(field: Field, event: Event) {
  if ('isComposing' in event && event.isComposing) return
  if (!selectedRow.value || selectedRow.value.kind === 'formal') return
  emit('update', selectedRow.value.kind, selectedRow.value.item.id, field, (event.target as HTMLInputElement).value)
}
function pick(kind: Kind, id: string) { emit('select', kind, id) }
function fieldBinding(field: Field) {
  return {
    id: `ChronicleEvents.${field}`,
    read: () => selectedRow.value ? field === 'characters' ? characters(selectedRow.value.item) : selectedRow.value.item[field] || '' : '',
    write: (value: string | number | boolean) => { const row = selectedRow.value;if (row && row.kind !== 'formal') emit('update', row.kind, row.item.id, field, String(value)) },
    identity: () => selectedRow.value?.item,
    label: () => `${fields.find(item => item.key === field)?.label || (field === 'event' ? '事件经过' : '结果与后续影响')} · ${selectedRow.value?.item.title || '当前事件'}`,
    available: () => !props.busy && selectedRow.value?.kind !== 'formal'
  }
}
</script>

<template>
  <section class="chronicle-events" data-testid="chronicle-events">
    <div class="chronicle-list-pane">
      <div class="chronicle-filter"><label><StudioIcon name="search" :size="16"/><input v-assist-field="{ id: 'ChronicleEvents.query', read: () => query, write: value => { query = String(value) } }" v-model="query" type="search" aria-label="搜索纪事事件" placeholder="搜索事件、人物或地点…" maxlength="200"></label><select v-assist-field="{ id: 'ChronicleEvents.origin', read: () => origin, write: value => { origin = String(value) } }" v-model="origin" aria-label="事件来源"><option value="all">全部记录</option><option value="direct">作者事件</option><option value="formal">资料确认</option></select></div>
      <div class="chronicle-list-caption"><span>故事记录 <b>{{ visible.length }}</b></span><small>按账本顺序 · 不推算故事日期</small></div>
      <div v-if="issue" class="chronicle-warning" role="alert" data-testid="timeline-event-ledger-locked">资料事件暂时无法读取，未将错误当作空账本。作者事件仍可编辑；请前往素材核对来源。<button type="button" @click="emit('review')">核对来源</button></div>
      <div class="chronicle-list-scroll">
        <section v-if="candidates.length" class="chronicle-candidates" data-testid="timeline-candidate-drawer"><header><b>待审阅候选</b><span>{{ candidates.length }} 项 · 采用并保存后才进入写作</span></header><button v-for="item in candidates" :key="item.id" type="button" class="chronicle-candidate-row" :aria-pressed="selected === `candidate:${item.id}`" @click="pick('candidate', item.id)"><StudioIcon name="spark" :size="15"/><span>{{ timelineEventTitle(item.event, item.title) }}</span><small>审阅 →</small></button></section>
        <ol v-if="visible.length" class="chronicle-records" aria-label="全书事件时间线">
          <li v-for="(row, index) in visible" :key="`${row.kind}:${row.item.id}`" class="timeline-node" :class="{ open: selected === `${row.kind}:${row.item.id}` }" data-testid="timeline-event-node">
            <button type="button" class="chronicle-record" :aria-pressed="selected === `${row.kind}:${row.item.id}`" @click="pick(row.kind, row.item.id)"><span class="chronicle-record-index">{{ String(index + 1).padStart(2, '0') }}</span><i class="chronicle-record-dot" aria-hidden="true"></i><span class="chronicle-record-copy"><small>{{ row.item.time || '时间待定' }}<em>{{ sourceLabel(row.kind) }}</em></small><b>{{ timelineEventTitle(row.item.event, row.item.title) }}</b><span>{{ row.item.event || '尚未填写事件经过' }}</span><small class="chronicle-record-meta">{{ row.item.location || '地点待补充' }}<span aria-hidden="true"> / </span>{{ characters(row.item) || '人物待补充' }}</small></span><StudioIcon name="chevron-right" :size="16"/></button>
          </li>
        </ol>
        <div v-else class="chronicle-empty"><span aria-hidden="true">事</span><h3>{{ rows.length ? '没有匹配的记录' : '故事，从一件事开始' }}</h3><p>{{ rows.length ? '换一个关键词，或查看全部来源。' : '记录一次相遇、一个决定，或改变故事方向的转折。' }}</p><button v-if="rows.length" type="button" @click="query = ''; origin = 'all'">清除筛选</button><button v-else type="button" @click="emit('add')">新建第一件事</button></div>
      </div>
      <footer class="chronicle-list-footer"><span>只有保存后的事件与确认的资料参与写作。</span><small>LOCAL ARCHIVE</small></footer>
    </div>
    <aside class="chronicle-dossier" aria-label="事件档案">
      <header class="chronicle-dossier-heading"><b>事件档案</b><span>EVENT DOSSIER</span></header>
      <div v-if="selectedRow" ref="dossierScroll" class="chronicle-dossier-scroll" data-testid="timeline-event-detail">
        <div class="chronicle-dossier-title"><small>{{ sourceLabel(selectedRow.kind) }}</small><h3>{{ timelineEventTitle(selectedRow.item.event, selectedRow.item.title) }}</h3></div>
        <form v-if="editing && selectedRow.kind !== 'formal'" class="chronicle-edit" :data-testid="selectedRow.kind === 'candidate' ? 'timeline-candidate-detail' : 'chronicle-event-editor'" @submit.prevent="selectedRow.kind === 'direct' && emit('save')">
          <label v-for="field in fields" :key="field.key">{{ field.label }}<input v-assist-field="fieldBinding(field.key)" :value="field.key === 'characters' ? characters(selectedRow.item) : selectedRow.item[field.key]" :maxlength="field.limit" :aria-label="field.label" @input="update(field.key, $event)" @compositionend="update(field.key, $event)"></label>
          <label>发生了什么<textarea v-assist-field="fieldBinding('event')" :value="selectedRow.item.event" maxlength="20000" aria-label="事件内容" @input="update('event', $event)" @compositionend="update('event', $event)"></textarea></label><label>结果与后续影响<textarea v-assist-field="fieldBinding('result')" :value="selectedRow.item.result" maxlength="20000" aria-label="结果与后续影响" @input="update('result', $event)" @compositionend="update('result', $event)"></textarea></label>
          <div v-if="selectedRow.kind === 'direct'" class="chronicle-edit-order"><button type="button" :disabled="directIndex <= 0" @click="emit('move', directIndex, -1)">上移</button><button type="button" :disabled="directIndex === direct.length - 1" @click="emit('move', directIndex, 1)">下移</button><button type="button" class="chronicle-delete" @click="emit('remove', directIndex)">删除事件</button></div>
        </form>
        <template v-else><dl class="chronicle-facts"><div><dt>时间</dt><dd>{{ selectedRow.item.time || '尚未记录' }}</dd></div><div><dt>人物</dt><dd>{{ characters(selectedRow.item) || '尚未记录' }}</dd></div><div><dt>地点</dt><dd>{{ selectedRow.item.location || '尚未记录' }}<button v-if="selectedRow.item.location" type="button" class="chronicle-inline-link" @click="emit('map', selectedRow.item.location)">在地图中查看 ↗</button></dd></div></dl><section class="chronicle-prose"><h4>发生了什么</h4><p>{{ selectedRow.item.event || '尚未补充' }}</p></section><section class="chronicle-prose"><h4>结果与后续影响</h4><p>{{ selectedRow.item.result || '尚未记录后续影响。' }}</p><button type="button" class="chronicle-inline-link" @click="emit('foreshadows')">查看伏笔备忘 ↗</button></section></template>
        <div class="chronicle-source-note">{{ selectedRow.kind === 'formal' ? '来自已确认资料，原始证据保留；修改请前往素材核对。' : selectedRow.kind === 'candidate' ? '这仍是候选，不会自动写入作品。采用后还需保存时间线。' : '作者记录。编辑后请保存时间线，不会自动修改章节正文。' }}</div>
      </div>
      <div v-else class="chronicle-empty chronicle-dossier-empty"><StudioIcon name="events" :size="30"/><h3>选择一件事</h3><p>在这里核对时间、人物、地点<br>以及它对后续故事的影响。</p></div>
      <footer v-if="selectedRow" class="chronicle-dossier-actions">
        <template v-if="selectedRow.kind === 'candidate'"><button type="button" @click="emit('discard', selectedRow.item.id)">舍弃</button><button type="button" class="chronicle-primary" :disabled="busy || !selectedRow.item.time.trim() || !characters(selectedRow.item).trim() || !selectedRow.item.location.trim() || !selectedRow.item.event.trim()" @click="emit('adopt', selectedRow.item)">采用为作者事件</button></template>
        <template v-else><button v-if="selectedChapter" type="button" class="chronicle-primary" @click="emit('chapter', selectedChapter.id)">打开对应章节 <StudioIcon name="arrow" :size="16"/></button><small v-else>尚未关联当前目录章节</small><button v-if="selectedRow.kind === 'formal'" type="button" @click="emit('review')">前往素材核对</button><button v-else-if="!editing" type="button" @click="editing = true">编辑记录</button><button v-else type="button" class="chronicle-primary" :disabled="busy" @click="emit('save')">保存时间线</button></template>
      </footer>
    </aside>
  </section>
</template>
