<script setup lang="ts">
import type { useDocumentReview } from './use-document-review'
defineProps<{ pending: number; staged: number; busy: boolean; error: string; recovery: boolean; context?: ReturnType<typeof useDocumentReview> }>()
defineEmits<{ retry: []; restore: [] }>()
</script>
<template>
  <aside v-if="pending || staged || error || recovery || context?.availability.value === 'absent' || context?.recoveryHistory.value.length" class="review-status" :class="{ 'review-uncreated': context?.availability.value === 'absent' }" aria-live="polite" data-testid="document-review-status">
    <span v-if="busy">正在处理修订…</span>
    <span v-else-if="recovery">有上次未保存的修订稿，正文尚未被覆盖。</span>
    <span v-else-if="context?.availability.value === 'absent'">尚无修订记录，首次保存后开始记录。</span>
    <span v-else-if="!error">{{ pending }} 处红字建议<span v-if="staged"> · {{ staged }} 处已保留，等待保存</span></span>
    <span v-if="error" role="alert">{{ error }}</span>
    <button v-if="recovery && !context?.baseChanged.value" type="button" :disabled="busy || context?.inputLocked.value" @click="$emit('restore')">恢复修订稿</button>
    <button v-if="error" type="button" :disabled="busy" @click="$emit('retry')">重新核对</button>
    <details v-if="context?.draft.value && (recovery || error)" class="recovery-compare"><summary>核对修订稿与正式稿</summary>
      <p v-if="context.baseChanged.value">正式稿已经改变，旧修订稿不能直接覆盖。可保留恢复记录后，从最新正式稿继续。</p>
      <div class="recovery-columns"><section><b>当前正式稿</b><pre>{{ context.snapshot.value?.content }}</pre></section><section><b>已记录的修订稿</b><pre>{{ context.draft.value.content }}</pre></section></div>
      <button type="button" :disabled="busy || context.inputLocked.value" @click="context.useLatest">使用最新正式稿，留存旧稿</button>
    </details>
    <details v-if="context?.recoveryHistory.value.length" class="recovery-compare"><summary>留存的恢复稿（最近 {{ context.recoveryHistory.value.length }} 份）</summary><details v-for="(draft, index) in context.recoveryHistory.value" :key="index"><summary>{{ draft.title }} · {{ draft.updatedAt }}</summary><pre>{{ draft.content }}</pre></details></details>
  </aside>
</template>
<style scoped>
.review-status { display:flex; flex-wrap:wrap; gap:.5rem; padding:.5rem 1rem; color:var(--cinnabar); background:var(--surface); font-size:.8125rem; border-bottom:1px solid var(--line); }
.review-status.review-uncreated { color:var(--muted); }
.recovery-compare { flex-basis:100%; max-height:20rem; overflow:auto; color:var(--ink); } .recovery-columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.6 var(--sans); max-height:12rem; overflow:auto; user-select:text; }
button { margin-left:auto; color:inherit; background:transparent; border:1px solid currentColor; padding:.2rem .65rem; cursor:pointer; }
</style>
