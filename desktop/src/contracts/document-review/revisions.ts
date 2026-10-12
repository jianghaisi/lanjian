import { buildWritingAgentDiff } from '../assistant/writing-diff'
import { createTextAnchor, locateTextAnchor } from './anchors'
import type { DocumentSnapshot, ReviewBlock } from './types'

/** Reuse the bounded semantic differ; block ids are namespaced by the real session. */
export function createReviewBlocks(sessionId: string, snapshot: Pick<DocumentSnapshot, 'content' | 'versionId' | 'hash'>, candidate: string): ReviewBlock[] {
  let offset = 0
  const blocks: ReviewBlock[] = []
  for (const block of buildWritingAgentDiff(snapshot.content, candidate)) {
    if (block.kind === 'change') blocks.push({ id: `${sessionId}:${block.id}`, sessionId,
      anchor: createTextAnchor(snapshot.content, offset, offset + block.before.length, snapshot.versionId, snapshot.hash),
      replacement: block.after, status: 'pending' })
    offset += block.before.length
  }
  return blocks
}

export function prepareBlockChange(content: string, block: ReviewBlock, currentHash?: string): { start: number; end: number; replacement: string; content: string } {
  if (block.status !== 'pending') throw new Error('这处修订已经处理，请刷新修订列表。')
  const position = locateTextAnchor(content, block.anchor, currentHash)
  if (position.status !== 'located') throw new Error('原文已经变化，无法确定修订位置；请重新定位或生成。')
  return { start: position.start, end: position.end, replacement: block.replacement,
    content: content.slice(0, position.start) + block.replacement + content.slice(position.end) }
}
