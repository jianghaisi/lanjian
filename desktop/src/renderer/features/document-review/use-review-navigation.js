import { onMounted, onBeforeUnmount } from 'vue'
import { decodeDocumentRef } from '../../../contracts/document-review/validation'
/** Navigate through the existing guarded editor routes; never replace a draft. */
export function useReviewNavigation(ports) {
  async function navigate(event) {
    try {
      const document = decodeDocumentRef(event.detail), book = ports.current.value?.id
      if (document.workItemId !== book) throw new Error('请回到这份建议所属的作品。')
      const snapshot = await ports.desktop.documentReview.readSnapshot(document)
      if (ports.current.value?.id !== book) return
      if (document.kind === 'total') await ports.selectWorkspaceLeaf('total-outline')
      else if (document.kind === 'volume') await ports.openVolumeOutline(snapshot.legacyId)
      else if (document.kind === 'stage') await ports.openStageOutline({ stage: snapshot.legacyId })
      else if (document.kind === 'chapter-outline') {
        const chapter = ports.outlineFullCatalog.value.find(c => c.id === snapshot.legacyId)
        if (!chapter) throw new Error('目标章纲已经变化，请在谋篇目录中重新打开。')
        await ports.openChapterFromOutlineCatalog(chapter)
      } else {
        await ports.selectWorkspaceLeaf('chapters')
        if (ports.current.value?.id === book && ports.activeWorkspaceLeaf.value?.id === 'chapters') await ports.selectChapter(await ports.desktop.chapters.get(snapshot.legacyId))
      }
    } catch (error) { ports.notice(error?.message || '目标文档未能打开，当前输入仍保留。') }
  }
  onMounted(() => window.addEventListener('document-review:navigate', navigate))
  onBeforeUnmount(() => window.removeEventListener('document-review:navigate', navigate))
}
