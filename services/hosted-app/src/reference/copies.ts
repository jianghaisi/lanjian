import { BookRegistry } from '../storage/books.ts'
import { HostedDatabase, dbString } from '../storage/database.ts'
import { BookRuntimes } from '../writing/book-runtime.ts'
import { WorkspaceWriteCoordinator } from '../../../../desktop/src/main/core/application/workspace-write-coordinator'
import { emptyWorldbookEntry } from '../../../../desktop/src/contracts/characters/worldbook'
import { assertTenantSpace } from '../files/quota.ts'
import { tenantParent } from '../files/tenant-root.ts'
import { readSite } from '../admin/site-store.ts'
import { referenceBook } from './book.ts'

export class ReferenceCopies {
  private readonly copies = new WorkspaceWriteCoordinator()
  constructor(readonly db: HostedDatabase, readonly books: BookRegistry, readonly runtimes: BookRuntimes) {}
  copy(owner: string) {
    return this.copies.run(owner, async () => {
      const b = referenceBook, key = `reference:${owner}:${b.version}`
      const previous = this.db.get('SELECT value FROM settings WHERE key=?', key)
      const saved = previous ? JSON.parse(dbString(previous.value)) as { id: string; done: string[] } : undefined
      if (saved?.done.includes('complete')) return this.books.get(owner, saved.id)
      await tenantParent(this.db.root, owner, true)
      await assertTenantSpace(this.db.root, owner, saved?.id ?? '', 16 * 1024 * 1024, readSite(this.db).limits)
      const book = saved ? this.books.get(owner, saved.id) : this.books.create(owner, { title: `${b.title} · 我的副本`, operation: `reference_${b.version}` })
      const state = saved ?? { id: book.id, done: [] as string[] }
      const persist = () => this.db.run('INSERT INTO settings VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=revision+1', key, JSON.stringify(state))
      // Persist before any asynchronous book initialization. Pending copies stay
      // hidden and their HTTP routes stay closed until the final receipt commits.
      this.db.transaction(() => {
        persist()
        this.db.run('INSERT INTO settings VALUES(?,?,1) ON CONFLICT(key) DO NOTHING', `reference-pending:${book.id}`, owner)
      })
      await this.runtimes.mutations.run(book.id, () => this.runtimes.run(owner, book.id, async r => {
        async function stage(name: string, work: () => Promise<void>) {
          if (state.done.includes(name)) return
          await work(); state.done.push(name); persist()
        }
        await stage('definitions', async () => {
          await r.workspace.saveBookProfile({ ...await r.workspace.bookProfile(), genre: b.genre, coreIdea: b.coreIdea, targetWordsPerChapter: 1000 })
          await r.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: `${b.permission}\n示例版本：${b.version}\n完整五章短篇；可自由编辑副本。`, worldView: b.worldView, useRealms: true, useSystem: true })
          await r.workspace.saveRealms(b.realms.map(x => ({ ...x })))
          await r.workspace.saveSystemTemplate(b.systemTemplate)
          for (const c of b.characters) {
            const existing = (await r.manuscripts.storyEntities(r.root)).find(e => e.entityType === 'character' && e.canonicalName === c.name)
            await r.manuscripts.saveStoryEntity(r.root, { ...(existing ? { id: existing.id } : {}), entityType: 'character', canonicalName: c.name,
              status: 'approved', profileJson: JSON.stringify({ worldbook: { ...emptyWorldbookEntry(), description: c.description } }) })
          }
          const existing = (await r.manuscripts.storyEntities(r.root)).find(e => e.entityType === 'world_rule' && e.canonicalName === '临汀镇与听纹规则')
          await r.manuscripts.saveStoryEntity(r.root, { ...(existing ? { id: existing.id } : {}), entityType: 'world_rule', canonicalName: '临汀镇与听纹规则', status: 'approved',
            profileJson: JSON.stringify({ worldbook: { ...emptyWorldbookEntry(), description: b.worldView } }) })
        })
        await stage('structure', async () => {
          if (!(await r.planning.status()).volumes.length) await r.planning.createVolume(b.volumeTitle)
          if ((await r.documents.outline('total')).content !== b.totalOutline) await r.planning.updateOutline('total', b.totalOutline)
          if ((await r.documents.outline(1)).content !== b.volumeOutline) await r.planning.updateOutline(1, b.volumeOutline)
          while ((await r.documents.chapters()).length < b.chapters.length) await r.documents.createChapter()
          const chapters = await r.documents.chapters()
          for (const chapter of chapters) await r.planning.placeChapter(chapter.id, 1)
          for (const scope of ['total', 1] as const) {
            const status = await r.planning.status(), review = scope === 'total' ? status.totalReview : status.volumes[0]!.review
            if (review.status === 'attention') await r.planning.acknowledgeOutlineReview(scope)
            await r.planning.confirmPlanningOutline(scope)
          }
          const entries = b.chapters.map((c, i) => ({ chapter: chapters[i]!.id, volume: 1, volumeChapter: i + 1, title: c.title, coreEvent: c.event, characters: [...c.characters], location: c.location, result: c.result }))
          const skeleton = await r.planning.inspectFormalSkeleton(entries, 1)
          await r.planning.adoptFormalSkeleton(entries, 1, skeleton.fingerprint)
        })
        const chapters = await r.documents.chapters()
        for (const [i, c] of b.chapters.entries()) {
          const chapterId = chapters[i]!.id
          await stage(`outline:${i}`, async () => {
            if ((await r.documents.chapterOutline(chapterId)).content !== c.outline) {
              const plan = await r.planning.prepareChapterEvent(chapterId, 1, c.title, c.outline,
                { time: c.time, characters: [...c.characters], location: c.location, event: c.event, result: c.result, evidenceRefs: [], confidence: 1 })
              await r.planning.commitChapterEvent(plan.root, plan.command)
            }
            await r.planning.confirmChapterOutline(chapterId)
          })
          await stage(`prose:${i}`, async () => {
            const current = await r.documents.chapter(chapterId)
            if (current.content !== c.content || current.title !== c.title) await r.documents.updateChapter(chapterId, { title: c.title, content: c.content, expectedRevision: current.revision! })
          })
        }
      }))
      this.db.transaction(() => { state.done.push('complete'); persist(); this.db.run('DELETE FROM settings WHERE key=?', `reference-pending:${book.id}`) })
      return this.books.get(owner, book.id)
    })
  }
}
