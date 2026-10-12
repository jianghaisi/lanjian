<script setup>
import StudioIcon from '../../../ui/StudioIcon.vue'
import { onBeforeUnmount, onMounted, ref, toRefs } from 'vue'

const props = defineProps({ scope: { type: Object, required: true } })
const {
  busy,
  chapterOrderIssue,
  chapterTitle,
  formatRevisionTime,
  nameCurrentRevision,
  restoreRevision,
  revisionDiffSummary,
  revisionLabelDraft,
  revisionReasonLabels,
  revisionViewMode,
  revisions,
  selectedChapterPosition,
  selectedId,
  selectedRevision,
  selectedRevisionChanges,
  selectedRevisionDiff,
  selectedRevisionId,
  showRevisions
} = toRefs(props.scope)

const ledger = ref(null)
const returnTarget = document.activeElement
onMounted(() => ledger.value?.querySelector('[aria-label="关闭历史版本"]')?.focus({ preventScroll: true }))
onBeforeUnmount(() => {
  const ownsFocus = document.activeElement === document.body || ledger.value?.contains(document.activeElement)
  if (ownsFocus && returnTarget instanceof HTMLElement && returnTarget.isConnected) {
    returnTarget.focus({ preventScroll: true })
  }
})
function handleKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    showRevisions.value = false
  } else if (event.key === 'Tab') {
    const controls = [...ledger.value.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && !element.closest('[inert]') && element.getClientRects().length)
    const boundary = event.shiftKey ? controls[0] : controls.at(-1)
    if (document.activeElement === boundary) {
      event.preventDefault()
      const destination = event.shiftKey ? controls.at(-1) : controls[0]
      destination?.focus()
    }
  }
}
</script>

<template>
  <div class="modal-backdrop revision-backdrop" @click.self="showRevisions = false">
    <section ref="ledger" class="revision-ledger" role="dialog" aria-modal="true" aria-labelledby="revision-title" @keydown="handleKeydown">
      <header>
        <div>
          <p class="eyebrow">落笔有痕 · 本地留档</p>
          <h2 id="revision-title">第 {{ selectedChapterPosition }} 章版本留痕</h2>
          <small>正文历史不会因命名、恢复或采用 AI 候选而被覆盖。</small>
        </div>
        <button type="button" aria-label="关闭历史版本" @click="showRevisions = false">
          <StudioIcon name="close" :size="18" />
        </button>
      </header>
      <form class="revision-name-bar" data-testid="revision-name-current" @submit.prevent="nameCurrentRevision">
        <span><b>给此刻留个名字</b><small>适合标记“第一幕定稿”“反转前版本”等关键节点</small></span>
        <input
          v-assist-field="{
            id: 'AppShell.revisionLabelDraft',
            read: () => revisionLabelDraft,
            write: (value) => {
              revisionLabelDraft = String(value)
            },
            identity: () => selectedId
          }"
          v-model="revisionLabelDraft"
          maxlength="80"
          aria-label="当前版本名称"
          placeholder="输入版本名称"
        />
        <button class="control-button secondary compact" type="submit" :disabled="busy || !revisionLabelDraft.trim()">
          保存标记
        </button>
      </form>
      <div v-if="revisions.length" class="revision-body">
        <nav aria-label="历史版本列表">
          <button
            v-for="revision in revisions"
            :key="revision.id"
            type="button"
            :class="{ selected: selectedRevision?.id === revision.id }"
            :aria-pressed="selectedRevision?.id === revision.id"
            :data-revision-current="revision.isCurrent ? 'true' : 'false'"
            @click="selectedRevisionId = revision.id"
          >
            <span class="revision-time-line"
              ><time>{{ formatRevisionTime(revision.createdAt) }}</time
              ><em v-if="revision.isCurrent">当前</em></span
            >
            <b>{{ revision.label || revision.title }}</b>
            <small
              ><template v-if="revision.label">{{ revision.title }} · </template
              >{{ revisionReasonLabels[revision.reason] || '正文备份' }} · {{ revision.word_count }} 字</small
            >
          </button>
        </nav>
        <article v-if="selectedRevision" class="revision-comparison">
          <header>
            <div>
              <span>{{ selectedRevision.isCurrent ? '当前正式正文' : '与当前正文比较' }}</span
              ><b>{{ selectedRevision.label || selectedRevision.title }}</b
              ><small v-if="selectedRevision.label">{{ selectedRevision.title }}</small>
            </div>
            <div class="revision-view-switch" role="group" aria-label="历史版本查看方式">
              <button
                type="button"
                :class="{ active: revisionViewMode === 'changes' }"
                data-testid="revision-view-changes"
                @click="revisionViewMode = 'changes'"
              >
                看改动
              </button>
              <button type="button" :class="{ active: revisionViewMode === 'full' }" @click="revisionViewMode = 'full'">
                看全文
              </button>
            </div>
          </header>
          <details v-if="selectedRevision.reviewedSource" class="revision-review-source">
            <summary>逐处保留的 AI 修订 · {{ selectedRevision.reviewedSource.application.sourceLinks.reduce((count, source) => count + source.blockIds.length, 0) }} 处</summary>
            <p v-for="source in selectedRevision.reviewedSource.application.sourceLinks" :key="source.artifactId">生成任务 {{ source.taskId }} · 保留 {{ source.blockIds.length }} 处。保存稿可能包含作者后续修改。</p>
          </details>
          <div v-if="revisionViewMode === 'changes'" :key="`changes-${selectedRevision.id}`" class="revision-diff revision-preview-arrive" data-testid="revision-diff">
            <div class="revision-diff-legend">
              <span><i class="historical"></i>这一版</span><span><i class="current"></i>当前正文</span>
              <b v-if="revisionDiffSummary.blocks || revisionDiffSummary.titleChanged"
                >{{ revisionDiffSummary.blocks }} 处正文变化<span v-if="revisionDiffSummary.titleChanged">
                  · 标题也有变化</span
                ></b
              >
              <b v-else>正文与标题没有变化</b>
            </div>
            <section v-if="revisionDiffSummary.titleChanged" class="revision-title-diff">
              <small>标题变化</small><del>{{ selectedRevision.title }}</del
              ><ins>{{ chapterTitle }}</ins>
            </section>
            <div v-if="selectedRevisionChanges.length" class="revision-diff-scroll">
              <template v-for="block in selectedRevisionDiff" :key="block.id">
                <pre v-if="block.kind === 'equal'" class="revision-unchanged">{{ block.before }}</pre>
                <section v-else class="revision-change-block">
                  <div>
                    <small>这一版 · {{ block.before.length }} 字符</small>
                    <pre>{{ block.before || '（此处原本没有文字）' }}</pre>
                  </div>
                  <div>
                    <small>当前正文 · {{ block.after.length }} 字符</small>
                    <pre>{{ block.after || '（当前已删除）' }}</pre>
                  </div>
                </section>
              </template>
            </div>
            <div v-else-if="!revisionDiffSummary.titleChanged" class="revision-no-change">
              <span>同</span>
              <p>所选历史稿与当前正文一致。</p>
            </div>
          </div>
          <div v-else :key="`full-${selectedRevision.id}`" class="revision-full-preview revision-preview-arrive">
            <div>
              <span>这一版全文</span><small>{{ selectedRevision.word_count }} 字</small>
            </div>
            <pre>{{ selectedRevision.content || '这一版尚无正文。' }}</pre>
          </div>
        </article>
      </div>
      <div v-else class="revision-empty">
        <span>痕</span>
        <h3>还没有历史版本</h3>
        <p>可以先给当前正文命名，或继续修改并保存。</p>
      </div>
      <footer>
        <span>版本只保存在当前作品中，不会上传；名称不修改正文内容。</span>
        <div>
          <button class="text-action" type="button" @click="showRevisions = false">返回正文</button
          ><button
            class="seal-action small"
            type="button"
            :disabled="Boolean(chapterOrderIssue) || !selectedRevision || selectedRevision.isCurrent || busy"
            @click="restoreRevision"
          >
            <span>{{ selectedRevision?.isCurrent ? '当前版本' : '恢复此版本' }}</span
            ><i>{{ selectedRevision?.isCurrent ? '今' : '复' }}</i>
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
