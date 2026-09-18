<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ManuscriptRecoveryDraft } from '../../manuscript/services/manuscript-recovery-store'

const props = defineProps<{ drafts: ManuscriptRecoveryDraft[]; error: string }>()
const emit = defineEmits<{ refresh: []; open: [draft: ManuscriptRecoveryDraft]; discard: [draft: ManuscriptRecoveryDraft] }>()
const selectedId = ref<number | null>(null)
const message = ref('')
const selected = computed(() => props.drafts.find(draft => draft.chapterId === selectedId.value) || props.drafts[0] || null)
const text = computed(() => selected.value ? `${selected.value.title}\n\n${selected.value.content}` : '')
watch(selected, () => { message.value = '' })
async function copy() {
  try { await navigator.clipboard.writeText(text.value); message.value = '恢复稿已复制，原草稿仍保留。' }
  catch { message.value = '无法自动复制，请在下方文本框中全选并复制。恢复稿仍保留。' }
}
</script>

<template>
  <section class="outline-recovery-shelf" data-testid="outline-recovery-shelf" aria-label="本作品章纲恢复稿">
    <header><div><h2>章纲恢复稿</h2><p>这里只显示本作品的本地草稿。原章纲已归档或已开始正文时，仍可取回全文。</p></div><button class="control-button secondary compact" @click="emit('refresh')">刷新</button></header>
    <p v-if="error" role="alert" class="recovery-error">{{ error }}</p>
    <template v-else-if="selected">
      <label class="draft-picker">选择恢复稿<select :value="selected.chapterId" aria-label="选择章纲恢复稿" @change="selectedId = Number(($event.target as HTMLSelectElement).value)"><option v-for="draft in drafts" :key="draft.chapterId" :value="draft.chapterId">{{ draft.title }} · 编号 {{ draft.chapterId }}</option></select></label>
      <textarea :value="text" readonly aria-label="章纲恢复稿全文" spellcheck="false" />
      <footer><p role="status">{{ message || '打开、查看或复制不会修改正式章纲，也不会重新建立已归档章节。' }}</p><div><button class="control-button secondary compact" data-testid="discard-shelf-recovery" @click="emit('discard', selected)">丢弃这份恢复稿</button><button class="control-button secondary compact" data-testid="open-shelf-outline" @click="emit('open', selected)">打开对应章纲</button><button class="control-button primary compact" data-testid="copy-shelf-recovery" @click="copy">复制全文</button></div></footer>
    </template>
    <p v-else class="empty">本作品没有待处理的章纲恢复稿。</p>
  </section>
</template>

<style scoped>
.outline-recovery-shelf { display: flex; flex-direction: column; gap: 20px; height: 100%; min-height: 0; min-width: 0; padding: 24px; font-family: var(--sans); color: var(--ink); }
header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
h2 { margin: 0; font: 600 20px/1.5 var(--sans); }
p { margin: 8px 0 0; color: var(--ink-soft); font-size: 13px; line-height: 1.7; }
.draft-picker { display: flex; gap: 16px; align-items: center; font-size: 14px; }
select { flex: 1; min-width: 0; padding: 9px 12px; color: var(--ink); background: var(--surface-raised); border: 1px solid var(--line); font: inherit; }
textarea { flex: 1; min-height: 100px; width: 100%; resize: none; padding: 20px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font: 15px/1.8 var(--sans); }
footer { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; }
footer div { display: flex; flex-wrap: wrap; gap: 8px; }
.recovery-error { color: var(--cinnabar); }
</style>
