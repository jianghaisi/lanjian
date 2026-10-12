import { operation, record, uuid } from '@lanjian/hosted-contracts'
import { decodeNoArgs } from '../../../../desktop/src/contracts/ipc'
import { unwrapValidatedIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import type { WritingRouteContext } from './writing-routes.ts'
import type { BookRuntimes } from '../writing/book-runtime.ts'
import { publicValue } from '../writing/public-value.ts'
import { fail } from './errors.ts'
import { desktopModelCatalog } from '../writing/desktop-models.ts'
import { desktopPublicValue } from '../writing/desktop-values.ts'
import type { ModelStore } from '../models/model-store.ts'
import { modelConnectionArgs } from '../../../../desktop/src/contracts/models/model-connections-contracts'
import { desktopLibraryModels } from '../writing/desktop-library-models.ts'

/** Fixed authenticated library endpoints. A browser never supplies a disk path. */
export function registerDesktopLibraryRoutes(ctx: WritingRouteContext, runtimes: BookRuntimes, models: ModelStore) {
  const recentKey = (owner: string) => `desktop-recent:${owner}`
  ctx.app.post('/api/desktop/library/projects/list', async request => {
    const current = ctx.write(request), payload = record(request.body, ['args', 'operation'])
    if (!Array.isArray(payload.args)) fail('invalid-request')
    operation(payload.operation)
    decodeNoArgs(payload.args)
    ctx.rate(`desktop-library:${current.user.id}`, 100)
    const projects: unknown[] = []
    for (const book of ctx.books.list(current.user.id)) {
      const summary = await runtimes.mutations.run(book.id, () => runtimes.run(current.user.id, book.id, r => r.projects.currentSummary()))
      projects.push(publicValue(summary, summary.path, book.id))
    }
    const recent = ctx.db.get('SELECT value FROM settings WHERE key=?', recentKey(current.user.id))?.value
    const result = { projects, continueProjectId: typeof recent === 'string' && ctx.books.list(current.user.id).some(b => b.id === recent) ? recent : null }
    return { ok: true, value: unwrapValidatedIpcResponse('projects:list', { ok: true, value: result }) }
  })
  ctx.app.post('/api/desktop/library/open', async request => {
    const current = ctx.write(request), input = record(request.body, ['id']), id = uuid(input.id)
    ctx.rate(`desktop-library:${current.user.id}`, 100)
    ctx.books.get(current.user.id, id)
    await runtimes.run(current.user.id, id, r => r.projects.currentPath())
    ctx.db.run('INSERT INTO settings VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=revision+1', recentKey(current.user.id), id)
    return { ok: true }
  })
  const globals = desktopModelCatalog(models)
  const libraryModels = desktopLibraryModels(ctx, runtimes, models)
  for (const name of ['defaults', 'previewCreation', 'createProject', 'cancelPreviews', 'cancelTest'] as const) ctx.app.post(`/api/desktop/library/model-connections/${name}`, async request => {
    const current = ctx.write(request), input = record(request.body, ['args', 'operation'])
    if (!Array.isArray(input.args)) fail('invalid-request')
    operation(input.operation); ctx.rate(`desktop-library:${current.user.id}`, 100)
    let value: unknown
    if (name === 'defaults') { modelConnectionArgs.defaults(input.args); value = await libraryModels.defaults(current.user.id) }
    else if (name === 'previewCreation') value = await libraryModels.previewCreation(current.user.id, modelConnectionArgs.previewCreation(input.args)[0])
    else if (name === 'createProject') { const p = modelConnectionArgs.createProject(input.args)[0]; value = await libraryModels.create(current.user.id, p.token, p.project) }
    else { modelConnectionArgs[name](input.args); value = name === 'cancelPreviews' ? libraryModels.cancel(current.user.id) : true }
    return { ok: true, value: unwrapValidatedIpcResponse(`model-connections:${name}`, { ok: true, value }) }
  })
  for (const name of ['list', 'catalog'] as const) ctx.app.post(`/api/desktop/library/model-connections/${name}`, async request => {
    const current = ctx.write(request), input = record(request.body, ['args', 'operation'])
    if (!Array.isArray(input.args)) fail('invalid-request')
    operation(input.operation); ctx.rate(`desktop-library:${current.user.id}`, 100)
    const value = name === 'list' ? (modelConnectionArgs.list(input.args), await globals.list()) : await globals.catalog(modelConnectionArgs.catalog(input.args)[0])
    return { ok: true, value: unwrapValidatedIpcResponse(`model-connections:${name}`, { ok: true, value }) }
  })
  ctx.app.post('/api/desktop/library/ai/background-tasks', async request => {
    const current = ctx.write(request), input = record(request.body, ['args', 'operation'])
    if (!Array.isArray(input.args)) fail('invalid-request')
    decodeNoArgs(input.args); operation(input.operation); ctx.rate(`desktop-background:${current.user.id}`, 100)
    const tasks: unknown[] = []
    for (const book of ctx.books.list(current.user.id)) {
      const entries = await runtimes.run(current.user.id, book.id, async r => desktopPublicValue(await r.projects.backgroundTasks.list(), r.root, book.id))
      tasks.push(...entries as unknown[])
    }
    return { ok: true, value: unwrapValidatedIpcResponse('ai:background-tasks', { ok: true, value: tasks }) }
  })
  return libraryModels
}
