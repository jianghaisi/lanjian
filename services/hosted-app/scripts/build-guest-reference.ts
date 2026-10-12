/** Offline only: render the bundled sample through the original core into public DTOs. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/http/app.ts'
import { desktopServices } from '../src/writing/desktop-services.ts'
import { desktopPrivateArgs, desktopPublicValue } from '../src/writing/desktop-values.ts'
import { validateIpcResponse, unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import { referenceBook } from '../src/reference/book.ts'

const root = await mkdtemp(join(tmpdir(), 'lanjian-public-sample-'))
const app = buildApp({ config: { dataDir: root, origin: 'http://127.0.0.1:5175', masterKey: randomBytes(32), adminIds: new Set(), host: '127.0.0.1', port: 0, development: true }, modelFetcher: async () => { throw new Error('Sample build cannot call a model') } })
const id = '00000000-0000-4000-8000-000000000001'
try {
  await app.app.ready()
  const user = app.identity.ensureUser({ subject: '999999999', username: 'bundled_sample', name: '原创样书' })
  const book = await app.referenceCopies.copy(user.id)
  const responses: Record<string, unknown> = {}
  await app.runtimes.run(user.id, book.id, async runtime => {
    const services = await desktopServices(runtime, app.jobs, app.models)
    async function capture(channel: string, args: unknown[] = []) {
      const handler = services.handlers.get(channel)
      if (!handler) return
      try {
        const value = validateIpcResponse(channel, desktopPublicValue(await handler(undefined, ...desktopPrivateArgs(args, runtime.root, book.id)), runtime.root, book.id))
        unwrapValidatedIpcResponse(channel, value)
        responses[JSON.stringify([channel, args])] = value
      } catch { /* Unsupported argument variants are not published. */ }
    }
    const reads = [
      'workspace:bootstrap','projects:sqlite-storage-status','projects:status','projects:migration-preview',
      'workspace:get-chapter-projection','workspace:get-workflow-status','projects:auto-backup-get',
      'chapters:list','chapters:autosave-recoveries','chapters:trash-list','chapters:stats',
      'outlines:list','outlines:tree','outlines:planning-status','chapter-outlines:list',
      'workspace:get-foundation','workspace:get-book-profile','workspace:get-foundation-status','workspace:get-realms','workspace:get-power-system',
      'workspace:get-cheat-system','workspace:get-system-template','research:get-settings','research:list-sources','research:list-events',
      'workspace:list-ideas','workspace:list-idea-generations','workspace:list-outline-expansions','workspace:list-task-center',
      'workspace:get-context-budget-preferences','workspace:get-context-fact-pack','workspace:get-prompt-profile','workspace:get-consistency-overview',
      'workspace:list-fact-batches','workspace:list-fact-extraction-jobs','workspace:list-character-aliases','workspace:list-story-entities',
      'workspace:list-story-entity-relations','workspace:get-resource-ledger','workspace:get-foreshadow-ledger','workspace:get-character-state',
      'workspace:get-character-lines','workspace:get-timeline','ai:background-tasks','ai:list-writing-agent-tasks','ai:get-settings',
      'model-connections:list','model-connections:book','events:projection','planning:draft','planning:chapter-skeleton-status',
      'planning:chapter-detail-statuses','assistant-runs:recent','annotation-revision:recent','world-map:workspace','world-map:get',
      'imports:recoverable-manifests','imports:continuation-state',
    ]
    for (const channel of reads) await capture(channel)
    await capture('assistant:recent-fields', [book.id])
    for (const chapter of await runtime.documents.chapters()) {
      for (const channel of ['chapters:get','chapters:get-planning','chapters:revisions','chapter-outlines:get','outlines:get-planned-chapter','workspace:get-chapter-projection','workspace:get-workflow-status']) await capture(channel, [chapter.id])
    }
    for (const scope of ['total', 1]) for (const channel of ['outlines:get','workspace:get-planning-outline']) await capture(channel, [scope])
    const summary = desktopPublicValue(await runtime.projects.currentSummary(), runtime.root, book.id)
    responses[JSON.stringify(['projects:list', []])] = { ok: true, value: { projects: [summary], continueProjectId: book.id } }
    responses[JSON.stringify(['projects:library-outline-preview', [book.id]])] = { ok: false, error: { code: 'FEATURE_UNAVAILABLE', message: '请打开样书查看完整目录。', recoverable: true } }
  })
  const serialized = JSON.stringify({ version: referenceBook.version, bookId: book.id, responses }).replaceAll(book.id, id).replaceAll(' · 我的副本', '')
  if (serialized.includes(root) || serialized.includes(user.id)) throw new Error('Private build metadata escaped projection')
  await writeFile(resolve('src/reference/guest-snapshot.json'), serialized + '\n')
  console.log(JSON.stringify({ responses: Object.keys(responses).length, bytes: Buffer.byteLength(serialized) }))
} finally { await app.app.close(); await rm(root, { recursive: true, force: true }) }
