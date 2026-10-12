import type { RecoverReviewedDraftInput } from '../../../../contracts/document-review/api'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import { createTextAnchor, locateTextAnchor, mapAnchorProjection, type TextChange } from '../../../../contracts/document-review/anchors'
import { createReviewBlocks } from '../../../../contracts/document-review/revisions'
import { snapshotChange } from '../../../../contracts/document-review/text-change'
import type { DocumentRef, DocumentReview, DocumentSnapshot, PreparedReviewDecision, ReviewApplicationReceipt, ReviewBlock, ReviewSource } from '../../../../contracts/document-review/types'
import type { AcknowledgeDecisionInput, DiscardDecisionInput, OpenReviewInput, PrepareDecisionInput, ReviewDraftRecord, ReviewSaveResult, SaveReviewedDraftInput, SyncReviewDraftInput } from '../domain/review-storage'

type StorePorts = {
  projectId: string
  now: () => string
  id: () => string
  snapshot: (document: DocumentRef) => DocumentSnapshot
  validateSource: (source: ReviewSource, document: DocumentRef) => void
  write: (snapshot: DocumentSnapshot, draft: ReviewDraftRecord, applicationId: string | null) => DocumentSnapshot
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function fail(message: string): never { throw new AppError('CONFLICT', message, { recoverable: true }) }
type Decision = { id: string; blockId: string; kind: string; payload: Record<string, unknown> }

/** Synchronous transaction participant. The workspace adapter owns transaction,
 * file-first journaling and recovery; this class never commits a separate DB. */
export class DocumentReviewStore {
  constructor(private readonly db: DatabaseSync, private readonly ports: StorePorts) {}

  list(document: DocumentRef): DocumentReview[] {
    this.ports.snapshot(document)
    const rows = this.db.prepare(`SELECT payload_json, EXISTS(SELECT 1 FROM document_review_blocks block WHERE block.session_id=session.id
      AND COALESCE((SELECT kind FROM document_review_decisions WHERE block_id=block.id ORDER BY seq DESC LIMIT 1),'pending') NOT IN ('committed','rejected')) AS active
      FROM document_review_sessions session WHERE project_id = ? AND document_kind = ? AND document_id = ? ORDER BY active DESC,created_at DESC,id DESC LIMIT 101`)
      .all(this.ports.projectId, document.kind, document.documentId)
    if (rows.length > 100 && rows[100]!.active) fail('待处理修订超过 100 份，请先处理已有修订。')
    return rows.slice(0, 100).map(row => {
      const review = JSON.parse(String(row.payload_json)) as DocumentReview
      return { ...review, blocks: review.blocks.map(block => ({ ...block, status: this.blockStatus(block.id) })) }
    })
  }

  draft(document: DocumentRef): ReviewDraftRecord | null {
    const row = this.db.prepare(`SELECT payload_json FROM document_review_drafts
      WHERE project_id = ? AND document_kind = ? AND document_id = ?`)
      .get(this.ports.projectId, document.kind, document.documentId)
    return row ? JSON.parse(String(row.payload_json)) as ReviewDraftRecord : null
  }

  recoveryHistory(document: DocumentRef): ReviewDraftRecord[] {
    this.ports.snapshot(document)
    return this.db.prepare('SELECT payload_json FROM document_review_recoveries WHERE project_id=? AND document_kind=? AND document_id=? ORDER BY seq DESC LIMIT 20')
      .all(this.ports.projectId, document.kind, document.documentId).map(row => JSON.parse(String(row.payload_json)) as ReviewDraftRecord)
  }
  useLatest(input: RecoverReviewedDraftInput): ReviewDraftRecord {
    const snapshot = this.ports.snapshot(input.document), draft = this.draft(input.document)
    if (!draft) fail('没有可核对的修订稿。')
    const previous = this.db.prepare('SELECT request_hash FROM document_review_recoveries WHERE operation_id=?').get(input.operationId)
    if (previous) { if (previous.request_hash !== hash(JSON.stringify(input))) fail('恢复操作编号已被使用。'); return draft }
    if (snapshot.revision !== input.expectedRevision || draft.revision !== input.expectedDraftRevision) fail('稿件已变化，请重新核对。')
    this.db.prepare('INSERT INTO document_review_recoveries(operation_id,project_id,document_kind,document_id,request_hash,payload_json) VALUES(?,?,?,?,?,?)')
      .run(input.operationId, this.ports.projectId, input.document.kind, input.document.documentId, hash(JSON.stringify(input)), JSON.stringify(draft))
    if (draft.content !== input.localContent || draft.title !== input.localTitle) this.db.prepare('INSERT INTO document_review_recoveries(operation_id,project_id,document_kind,document_id,request_hash,payload_json) VALUES(?,?,?,?,?,?)')
      .run(`${input.operationId}:editor`, this.ports.projectId, input.document.kind, input.document.documentId, hash(JSON.stringify(input)), JSON.stringify({ ...draft, title: input.localTitle, content: input.localContent }))
    for (const id of draft.stagedDecisionIds) {
      const decision = this.decision(id) || fail('待保存的修订记录缺失。')
      this.appendDecision(this.ports.id(), `${input.operationId}:${id}`, decision.blockId, 'withdrawn', { decisionId: id, recoveryOperationId: input.operationId })
    }
    const next = this.freshDraft(snapshot)
    next.revision = draft.revision + 1
    next.anchors = draft.anchors
    for (const [id, anchor] of Object.entries(next.anchors)) next.positions[id] = locateTextAnchor(snapshot.content, anchor, snapshot.hash)
    this.putDraft(next)
    return next
  }

  anchorAnnotation(snapshot: DocumentSnapshot, title: string, content: string, id: string, start: number, end: number, expectedDraftRevision: number | null) {
    const existing = this.draft(snapshot.ref)
    if ((existing?.revision ?? null) !== expectedDraftRevision) fail('编辑稿已变化，批注输入仍保留，请重试。')
    let draft = existing || this.freshDraft(snapshot)
    if (draft.baseRevision !== snapshot.revision) fail('修订稿与正式稿已不同，请先核对恢复稿再添加批注。')
    if (draft.content !== content || draft.title !== title) draft = this.sync({ document: snapshot.ref, expectedDraftRevision: draft.revision,
      title, changes: snapshotChange(draft.content, content) })
    if (start === end) fail('请先选中要批注的文字。')
    const anchor = createTextAnchor(content, start, end, snapshot.versionId, hash(content))
    draft.anchors[`annotation:${id}`] = anchor
    draft.positions[`annotation:${id}`] = { start, end, status: 'located' }
    draft.revision++
    this.putDraft(draft)
    return anchor
  }

  open(input: OpenReviewInput): DocumentReview {
    const { snapshot, source, baseDraft, candidate } = input
    const prior = this.db.prepare('SELECT payload_json FROM document_review_sessions WHERE artifact_id = ?').get(source.artifactId)
    if (prior) {
      const existing = JSON.parse(String(prior.payload_json)) as DocumentReview
      if (existing.document.documentId !== snapshot.ref.documentId || existing.source.artifactHash !== source.artifactHash) fail('候选已属于另一份修订记录。')
      return { ...existing, blocks: existing.blocks.map(block => ({ ...block, status: this.blockStatus(block.id) })) }
    }
    this.ports.validateSource(source, snapshot.ref)
    if (this.list(snapshot.ref).filter(review => review.blocks.some(block => ['pending', 'staged', 'conflicted'].includes(block.status))).length >= 100) fail('请先处理已有的 100 份修订，再打开新候选。')
    const id = this.ports.id()
    const blocks = createReviewBlocks(id, { content: baseDraft, versionId: snapshot.versionId, hash: hash(baseDraft) }, candidate)
    if (!blocks.length) fail('这份候选没有可采用的变化。')
    const review: DocumentReview = { id, document: snapshot.ref, source, baseVersionId: snapshot.versionId,
      baseRevision: snapshot.revision, baseDraft, createdAt: this.ports.now(), blocks }
    this.db.prepare(`INSERT INTO document_review_sessions(id,project_id,document_kind,document_id,task_id,artifact_id,artifact_hash,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, this.ports.projectId, snapshot.ref.kind, snapshot.ref.documentId, source.taskId, source.artifactId, source.artifactHash, JSON.stringify(review), review.createdAt)
    for (const block of blocks) this.db.prepare('INSERT INTO document_review_blocks(id,session_id,payload_json) VALUES(?,?,?)').run(block.id, id, JSON.stringify(block))
    const current = this.ports.snapshot(snapshot.ref)
    const draft = this.draft(snapshot.ref) || this.freshDraft(current)
    for (const block of blocks) {
      draft.anchors[block.id] = block.anchor
      draft.positions[block.id] = locateTextAnchor(draft.content, block.anchor, hash(draft.content))
    }
    draft.revision++
    this.putDraft(draft)
    return review
  }

  sync(input: SyncReviewDraftInput): ReviewDraftRecord {
    const current = this.ports.snapshot(input.document)
    const draft = this.draft(input.document) || this.freshDraft(current)
    if (draft.revision !== input.expectedDraftRevision || draft.baseRevision !== current.revision) fail('编辑稿或正式版本已经变化，请保留当前输入并重新核对。')
    const content = applyChanges(draft.content, input.changes)
    // Only an explicit editor history operation can withdraw/reinstate an
    // uncommitted adoption. Ordinary typing never erases its AI provenance.
    if (input.historyDirection) this.syncHistory(input, draft, content)
    for (const [id, position] of Object.entries(draft.positions)) {
      draft.positions[id] = mapAnchorProjection(position, input.changes)
      if (draft.positions[id]!.status === 'located') {
        const next = draft.positions[id]!
        draft.anchors[id] = createTextAnchor(content, next.start, next.end, current.versionId, hash(content))
      }
    }
    if (input.historyDirection === 'undo') for (const review of this.list(input.document)) for (const block of review.blocks) {
      if (block.status === 'pending') {
        const relocated = locateTextAnchor(content, block.anchor, hash(content))
        if (relocated.status === 'located') { draft.positions[block.id] = relocated; draft.anchors[block.id] = block.anchor }
      }
    }
    for (const decisionId of input.withdrawDecisionIds || []) {
      if (!draft.stagedDecisionIds.includes(decisionId)) fail('撤销决定不属于当前待保存稿。')
      const decision = this.decision(decisionId)
      if (!decision || decision.kind !== 'staged') fail('这处修订无法撤销。')
      this.appendDecision(this.ports.id(), this.ports.id(), decision.blockId, 'withdrawn', { decisionId })
      draft.stagedDecisionIds = draft.stagedDecisionIds.filter(id => id !== decisionId)
    }
    draft.title = input.title
    draft.content = content
    draft.revision++
    this.putDraft(draft)
    return draft
  }

  private syncHistory(input: SyncReviewDraftInput, draft: ReviewDraftRecord, content: string) {
    const resultHash = hash(content)
    for (const review of this.list(input.document)) for (const block of review.blocks) {
      const latest = this.db.prepare('SELECT id FROM document_review_decisions WHERE block_id = ? ORDER BY seq DESC LIMIT 1').get(block.id)
      const decision = latest ? this.decision(String(latest.id)) : null
      if (!decision) continue
      const prepared = typeof decision.payload.permitId === 'string' ? this.decision(decision.payload.permitId) : null
      if (!prepared || prepared.kind !== 'prepared') continue
      const permit = prepared.payload as unknown as PreparedReviewDecision
      if (input.historyDirection === 'undo' && decision.kind === 'staged' && draft.stagedDecisionIds.includes(decision.id) && resultHash === permit.expectedDraftHash) {
        this.appendDecision(this.ports.id(), this.ports.id(), block.id, 'withdrawn', { decisionId: decision.id, permitId: permit.id })
        draft.stagedDecisionIds = draft.stagedDecisionIds.filter(id => id !== decision.id)
      } else if (input.historyDirection === 'redo' && decision.kind === 'withdrawn' && resultHash === permit.resultingDraftHash) {
        this.ports.validateSource(review.source, input.document)
        const id = this.ports.id()
        this.appendDecision(id, this.ports.id(), block.id, 'staged', { permitId: permit.id, contentHash: resultHash })
        draft.stagedDecisionIds.push(id)
      }
    }
  }

  prepare(input: PrepareDecisionInput): PreparedReviewDecision {
    const block = this.block(input.document, input.blockId)
    const prior = this.db.prepare('SELECT payload_json FROM document_review_decisions WHERE operation_id = ?').get(input.operationId)
    if (prior) {
      const permit = JSON.parse(String(prior.payload_json)) as PreparedReviewDecision
      const draft = this.draft(input.document)
      if (permit.blockId !== input.blockId || permit.document.documentId !== input.document.documentId
        || !draft || draft.revision !== input.expectedDraftRevision || hash(draft.content) !== permit.expectedDraftHash) fail('操作编号已经用于另一处修订或稿件版本。')
      return permit
    }
    if (block.status !== 'pending') fail('这处修订已经处理。')
    this.ports.validateSource(this.list(input.document).find(review => review.blocks.some(item => item.id === block.id))!.source, input.document)
    const current = this.ports.snapshot(input.document), draft = this.draft(input.document)
    if (!draft || draft.revision !== input.expectedDraftRevision || draft.baseRevision !== current.revision) fail('稿件版本已经变化，未采用修订。')
    const position = draft.positions[block.id]
    if (!position || position.status !== 'located' || draft.content.slice(position.start, position.end) !== block.anchor.quote) fail('原文已经变化，无法确定这处修订的位置。')
    const content = draft.content.slice(0, position.start) + block.replacement + draft.content.slice(position.end)
    const permit: PreparedReviewDecision = { id: this.ports.id(), document: input.document, blockId: block.id,
      expectedDraftHash: hash(draft.content), resultingDraftHash: hash(content), start: position.start, end: position.end,
      replacement: block.replacement, expiresAt: new Date(Date.parse(this.ports.now()) + 60_000).toISOString() }
    this.appendDecision(permit.id, input.operationId, block.id, 'prepared', permit)
    return permit
  }

  acknowledge(input: AcknowledgeDecisionInput): ReviewDraftRecord {
    const decision = this.decision(input.permitId)
    if (!decision || decision.kind !== 'prepared') fail('修订确认依据不存在。')
    const permit = decision.payload as unknown as PreparedReviewDecision
    this.block(input.document, permit.blockId)
    this.ports.validateSource(this.list(input.document).find(review => review.blocks.some(item => item.id === permit.blockId))!.source, input.document)
    const draft = this.draft(input.document)
    if (!draft || permit.document.documentId !== input.document.documentId || permit.resultingDraftHash !== input.resultingDraftHash) fail('编辑稿与这次修订确认不一致。')
    const already = this.db.prepare("SELECT id FROM document_review_decisions WHERE block_id = ? AND kind = 'staged' AND json_extract(payload_json,'$.permitId') = ?").get(permit.blockId, permit.id)
    if (already && draft.stagedDecisionIds.includes(String(already.id))) return draft
    if (Date.parse(permit.expiresAt) < Date.parse(this.ports.now()) || hash(draft.content) !== permit.expectedDraftHash
      || this.ports.snapshot(input.document).revision !== draft.baseRevision || this.blockStatus(permit.blockId) !== 'pending') fail('原文或确认依据已变化，未记录为采用。')
    const changes = [{ from: permit.start, to: permit.end, insert: permit.replacement }]
    const content = applyChanges(draft.content, changes)
    for (const [id, position] of Object.entries(draft.positions)) {
      if (id === permit.blockId) continue
      const next = mapAnchorProjection(position, changes)
      draft.positions[id] = next
      if (next.status === 'located') draft.anchors[id] = createTextAnchor(content, next.start, next.end, draft.anchors[id]!.versionId, hash(content))
    }
    const id = this.ports.id()
    this.appendDecision(id, permit.id + ':stage', permit.blockId, 'staged', { permitId: permit.id, contentHash: hash(content) })
    draft.content = content
    draft.stagedDecisionIds.push(id)
    draft.revision++
    this.putDraft(draft)
    return draft
  }

  discard(input: DiscardDecisionInput): DocumentReview[] {
    const block = this.block(input.document, input.blockId)
    const prior = this.db.prepare('SELECT block_id,kind FROM document_review_decisions WHERE operation_id = ?').get(input.operationId)
    if (prior) {
      if (prior.block_id !== block.id || prior.kind !== 'rejected') fail('操作编号已经使用。')
      return this.list(input.document)
    }
    if (block.status !== 'pending' && block.status !== 'conflicted') fail('已保留的修订请使用编辑器撤销。')
    this.appendDecision(this.ports.id(), input.operationId, block.id, 'rejected', {})
    this.finishSources(input.document)
    return this.list(input.document)
  }

  save(input: SaveReviewedDraftInput): ReviewSaveResult {
    const requestHash = hash(JSON.stringify(input))
    const previous = this.db.prepare('SELECT request_hash,receipt_json FROM document_review_applications WHERE id = ?').get(input.operationId)
    if (previous) {
      if (previous.request_hash !== requestHash || !previous.receipt_json) fail('此保存操作已使用或尚待恢复。')
      return { snapshot: this.ports.snapshot(input.document), receipt: JSON.parse(String(previous.receipt_json)) as ReviewApplicationReceipt }
    }
    const current = this.ports.snapshot(input.document), draft = this.draft(input.document)
    if (!draft || current.revision !== input.expectedRevision || draft.baseRevision !== current.revision || draft.revision !== input.expectedDraftRevision) fail('保存依据已经变化，当前稿与修订仍然保留。')
    const reviews = this.list(input.document)
    const decisions = draft.stagedDecisionIds.map(id => this.decision(id) || fail('待保存修订记录缺失。'))
    const links: ReviewApplicationReceipt['sourceLinks'] = []
    for (const decision of decisions) {
      const review = reviews.find(item => item.blocks.some(block => block.id === decision.blockId && block.status === 'staged')) || fail('修订状态已变化。')
      this.ports.validateSource(review.source, input.document)
      const existing = links.find(link => link.artifactId === review.source.artifactId)
      if (existing) existing.blockIds.push(decision.blockId)
      else links.push({ ...review.source, blockIds: [decision.blockId] })
    }
    const applicationId = decisions.length ? input.operationId : null
    if (applicationId) {
      if (current.content === draft.content && current.title === draft.title) fail('本次修订没有产生稿件变化，请先撤销待保存的采用决定。')
      this.db.prepare(`INSERT INTO document_review_applications(id,project_id,document_kind,document_id,previous_version_id,content_hash,title,request_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(applicationId, this.ports.projectId, input.document.kind, input.document.documentId, current.versionId, hash(draft.content), draft.title, requestHash, this.ports.now())
      for (const decision of decisions) {
        const review = reviews.find(item => item.blocks.some(block => block.id === decision.blockId))!
        this.db.prepare('INSERT INTO document_review_application_sources(application_id,session_id,block_id,decision_id) VALUES(?,?,?,?)')
          .run(applicationId, review.id, decision.blockId, decision.id)
      }
    }
    const saved = this.ports.write(current, draft, applicationId)
    const receipt: ReviewApplicationReceipt | null = applicationId ? { id: applicationId, document: input.document,
      previousVersionId: current.versionId, versionId: saved.versionId, revision: saved.revision, contentHash: saved.hash, sourceLinks: links } : null
    if (receipt) this.db.prepare('UPDATE document_review_applications SET receipt_json = ? WHERE id = ?').run(JSON.stringify(receipt), applicationId!)
    for (const decision of decisions) this.appendDecision(this.ports.id(), `${input.operationId}:${decision.id}`, decision.blockId, 'committed', { applicationId })
    draft.baseRevision = saved.revision
    draft.stagedDecisionIds = []
    draft.revision++
    this.putDraft(draft)
    this.finishSources(input.document)
    return { snapshot: saved, receipt }
  }

  private finishSources(document: DocumentRef) {
    for (const review of this.list(document)) {
      if (review.blocks.some(block => ['pending', 'staged', 'conflicted'].includes(block.status))) continue
      const adopted = review.blocks.some(block => block.status === 'committed')
      const artifact = this.db.prepare('SELECT metadata_json FROM generation_artifacts WHERE id = ?').get(review.source.artifactId)
      this.db.prepare("UPDATE generation_artifacts SET status = ?, metadata_json = ?, updated_at = ? WHERE id = ? AND status = 'complete'")
        .run(adopted ? 'applied' : 'discarded', JSON.stringify({ ...JSON.parse(String(artifact?.metadata_json || '{}')), reviewSessionId: review.id, decision: adopted ? 'applied' : 'discarded' }), this.ports.now(), review.source.artifactId)
    }
  }

  private block(document: DocumentRef, id: string): ReviewBlock {
    return this.list(document).flatMap(review => review.blocks).find(block => block.id === id) || fail('修订不属于当前文档。')
  }
  private blockStatus(id: string): ReviewBlock['status'] {
    const row = this.db.prepare('SELECT kind FROM document_review_decisions WHERE block_id = ? ORDER BY seq DESC LIMIT 1').get(id)
    return row?.kind === 'staged' ? 'staged' : row?.kind === 'committed' ? 'committed' : row?.kind === 'rejected' ? 'rejected' : 'pending'
  }
  private decision(id: string): Decision | null {
    const row = this.db.prepare('SELECT id,block_id,kind,payload_json FROM document_review_decisions WHERE id = ?').get(id)
    return row ? { id: String(row.id), blockId: String(row.block_id), kind: String(row.kind), payload: JSON.parse(String(row.payload_json)) } : null
  }
  private appendDecision(id: string, operationId: string, blockId: string, kind: string, payload: object) {
    this.db.prepare('INSERT INTO document_review_decisions(id,operation_id,block_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, operationId, blockId, kind, JSON.stringify(payload), this.ports.now())
  }
  private freshDraft(snapshot: DocumentSnapshot): ReviewDraftRecord {
    return { document: snapshot.ref, title: snapshot.title, content: snapshot.content, baseRevision: snapshot.revision,
      revision: 1, stagedDecisionIds: [], anchors: {}, positions: {}, updatedAt: this.ports.now() }
  }
  private putDraft(draft: ReviewDraftRecord) {
    draft.updatedAt = this.ports.now()
    this.db.prepare(`INSERT INTO document_review_drafts(project_id,document_kind,document_id,revision,payload_json) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id,document_kind,document_id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json`)
      .run(this.ports.projectId, draft.document.kind, draft.document.documentId, draft.revision, JSON.stringify(draft))
  }
}

function applyChanges(content: string, changes: readonly TextChange[]): string {
  let result = '', end = 0
  for (const change of changes) {
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < end || change.to < change.from || change.to > content.length) fail('编辑事务范围无效。')
    result += content.slice(end, change.from) + change.insert
    end = change.to
  }
  return result + content.slice(end)
}
