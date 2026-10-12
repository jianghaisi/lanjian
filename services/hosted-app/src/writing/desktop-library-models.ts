import { randomUUID } from 'node:crypto'
import { record, text } from '@lanjian/hosted-contracts'
import type { ModelDefaultsView } from '../../../../desktop/src/contracts/models/model-connections-contracts'
import type { WritingRouteContext } from '../http/writing-routes.ts'
import type { BookRuntimes } from './book-runtime.ts'
import type { ModelStore } from '../models/model-store.ts'
import { desktopPublicValue } from './desktop-values.ts'
import { fail } from '../http/errors.ts'

/** Retains the core creation handshake; model selection belongs to the operator. */
export function desktopLibraryModels(ctx: WritingRouteContext, runtimes: BookRuntimes, _models: ModelStore) {
  const previews = new Map<string, { owner: string; expires: number }>()
  async function defaults(_owner: string): Promise<ModelDefaultsView> { return { revision: 0, catalogRevision: 0, template: null, references: [] } }
  async function previewCreation(owner: string, _manual: boolean) {
    for (const [token, p] of previews) if (p.expires <= ctx.db.now()) previews.delete(token)
    if ([...previews.values()].filter(p => p.owner === owner).length >= 32) fail('request-limit')
    const token = randomUUID()
    previews.set(token, { owner, expires: ctx.db.now() + 15 * 60_000 })
    return { token, defaults: await defaults(owner), withoutDefaults: true }
  }
  function cancel(owner: string) { for (const [token, p] of previews) if (p.owner === owner) previews.delete(token); return true }
  function validate(owner: string, token: string, project: unknown) {
    const preview = previews.get(token)
    if (!preview || preview.owner !== owner || preview.expires <= ctx.db.now()) fail('conflict')
    const input = record(project, ['name', 'parentPath', 'genre'])
    if (input.parentPath !== '账户书库') fail('invalid-request')
    text(input.name,120)
    if (input.genre !== undefined) text(input.genre,80)
    return input
  }
  async function create(owner: string, token: string, project: unknown) {
    const input=validate(owner,token,project)
    const book = ctx.books.create(owner, { title: text(input.name, 120), operation: `desktop_create_${token}` })
    return runtimes.mutations.run(book.id, () => runtimes.run(owner, book.id, async r => {
      const marker=`desktop-create-definition:${book.id}`
      if (!ctx.db.get('SELECT value FROM settings WHERE key=?',marker)) {
        const profile=await r.workspace.bookProfile()
        if (input.genre && (!profile.genre || profile.genre==='未分类')) await r.workspace.saveBookProfile({...profile,genre:text(input.genre,80)})
        ctx.db.run('INSERT OR IGNORE INTO settings VALUES(?,?,1)',marker,'initialized')
      }
      return { status: 'created', project: desktopPublicValue(await r.projects.currentSummary(), r.root, book.id) }
    }))
  }
  return { defaults, previewCreation, create, cancel, validate }
}
