import { record, operation, uuid } from '@lanjian/hosted-contracts'
import { validateIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import { readSite } from '../admin/site-store.ts'
import { assertTenantSpace } from '../files/quota.ts'
import { desktopServices } from '../writing/desktop-services.ts'
import { desktopPrivateArgs, desktopPublicValue } from '../writing/desktop-values.ts'
import type { BookRuntime, BookRuntimes } from '../writing/book-runtime.ts'
import type { HostedJobs } from '../tasks/jobs.ts'
import type { ModelStore } from '../models/model-store.ts'
import type { WritingRouteContext } from './writing-routes.ts'
import { fail } from './errors.ts'
import { digest, dbString } from '../storage/database.ts'
import { desktopWorkspaceCommands } from './desktop-workspace-commands.ts'
import { registerDesktopAiRoutes } from './desktop-ai-routes.ts'

// Deliberate fixed routes. Adding a core IPC handler never publishes an HTTP API.
// AI starts, native paths and provider configuration require separate admission.
export const desktopBookCommands = [
  ...desktopWorkspaceCommands,
  'workspace:bootstrap', 'workspace:recheck-load-issues', 'projects:sqlite-storage-status', 'projects:status', 'projects:migration-preview',
  'workspace:get-chapter-projection', 'workspace:get-workflow-status', 'projects:auto-backup-get', 'projects:auto-backup-run',
  'chapters:list', 'chapters:create', 'chapters:get', 'chapters:get-planning', 'chapters:update-planning', 'chapters:update',
  'chapters:autosave-stage', 'chapters:autosave-finalize', 'chapters:autosave-recoveries', 'chapters:autosave-discard',
  'chapters:preserve-draft', 'chapters:reorder', 'chapters:delete', 'chapters:trash-list', 'chapters:restore', 'chapters:stats',
  'chapters:revisions', 'chapters:name-current-revision', 'chapters:restore-revision',
  'outlines:list', 'outlines:get', 'outlines:update', 'outlines:tree', 'outlines:planning-status', 'outlines:acknowledge-review',
  'outlines:confirm-planning', 'outlines:create-volume', 'outlines:create-stage', 'outlines:update-stage', 'outlines:rename-volume',
  'chapter-outlines:list', 'chapter-outlines:get', 'chapter-outlines:update',
  'workspace:get-foundation', 'workspace:get-book-profile', 'workspace:save-book-profile', 'workspace:save-foundation',
  'workspace:get-foundation-status', 'workspace:get-realms', 'workspace:save-realms', 'workspace:get-power-system', 'workspace:save-power-system',
  'workspace:get-cheat-system', 'workspace:save-cheat-system', 'workspace:get-system-template', 'workspace:save-system-template',
  'research:get-settings', 'research:list-sources', 'research:create-source', 'research:update-source',
  'workspace:list-ideas', 'workspace:save-idea', 'workspace:list-idea-generations', 'workspace:list-outline-expansions',
  'workspace:list-task-center', 'workspace:get-context-budget-preferences', 'workspace:save-context-budget-preferences',
  'workspace:get-context-fact-pack', 'workspace:get-prompt-profile', 'workspace:save-prompt-override', 'workspace:reset-prompt-override',
  'workspace:get-consistency-overview', 'workspace:list-fact-batches', 'workspace:list-fact-extraction-jobs',
  'workspace:list-character-aliases', 'workspace:replace-character-aliases', 'workspace:list-story-entities', 'workspace:save-story-entity',
  'workspace:list-story-entity-relations', 'workspace:save-story-entity-relation', 'workspace:get-resource-ledger', 'workspace:append-resource-ledger',
  'workspace:get-foreshadow-ledger', 'workspace:record-foreshadow-action', 'workspace:get-character-state',
  'ai:background-tasks', 'ai:list-writing-agent-tasks', 'ai:get-settings',
  'model-connections:list', 'model-connections:catalog',
  'events:projection', 'events:operation-receipt', 'planning:draft', 'planning:chapter-skeleton-status', 'planning:chapter-detail-statuses',
  'events:settlement-cancel', 'assistant:recent-fields', 'assistant-runs:recent',
  'document-review:snapshot', 'document-review:outline-history', 'document-review:outline-version', 'document-review:list',
  'document-review:recover', 'document-review:recovery-history', 'document-annotations:list', 'document-annotations:create',
  'document-annotations:update', 'document-annotations:reanchor', 'document-annotations:remove', 'document-annotations:resolve', 'document-annotations:reopen'
] as const

const reads = new Set<string>([
  'workspace:bootstrap', 'workspace:recheck-load-issues', 'projects:sqlite-storage-status', 'projects:status', 'projects:migration-preview',
  'workspace:get-chapter-projection', 'workspace:get-workflow-status', 'projects:auto-backup-get',
  'chapters:list', 'chapters:get', 'chapters:get-planning', 'chapters:autosave-recoveries', 'chapters:trash-list', 'chapters:stats', 'chapters:revisions',
  'outlines:list', 'outlines:get', 'outlines:tree', 'outlines:planning-status', 'chapter-outlines:list', 'chapter-outlines:get',
  'workspace:get-foundation', 'workspace:get-book-profile', 'workspace:get-foundation-status', 'workspace:get-realms', 'workspace:get-power-system',
  'workspace:get-cheat-system', 'workspace:get-system-template', 'research:get-settings', 'research:list-sources',
  'workspace:list-ideas', 'workspace:list-idea-generations', 'workspace:list-outline-expansions', 'workspace:list-task-center',
  'workspace:get-context-budget-preferences', 'workspace:get-context-fact-pack', 'workspace:get-prompt-profile', 'workspace:get-consistency-overview',
  'workspace:list-fact-batches', 'workspace:list-fact-extraction-jobs', 'workspace:list-character-aliases', 'workspace:list-story-entities',
  'workspace:list-story-entity-relations', 'workspace:get-resource-ledger', 'workspace:get-foreshadow-ledger', 'workspace:get-character-state',
  'ai:background-tasks', 'ai:list-writing-agent-tasks', 'ai:get-settings', 'model-connections:list', 'model-connections:catalog', 'model-connections:book',
  'events:projection', 'events:operation-receipt', 'planning:draft', 'planning:chapter-skeleton-status', 'planning:chapter-detail-statuses',
  'events:settlement-cancel', 'assistant:recent-fields', 'assistant-runs:recent',
  'document-review:snapshot', 'document-review:outline-history', 'document-review:outline-version', 'document-review:list',
  'document-review:recover', 'document-review:recovery-history', 'document-annotations:list'
])
const creates = new Set<string>(['chapters:create', 'outlines:create-volume', 'outlines:create-stage'])

export function registerDesktopBookRoutes(ctx: WritingRouteContext, runtimes: BookRuntimes, jobs: HostedJobs, models: ModelStore) {
  const services = new WeakMap<BookRuntime, ReturnType<typeof desktopServices>>()
  const getRuntime = async (r: BookRuntime) => {
    let runtime = services.get(r)
    if (!runtime) {
      runtime = desktopServices(r, jobs, models).then(created => {
        if (desktopBookCommands.some(name => !created.handlers.has(name))) fail('internal-error')
        return created
      }).catch(error => { services.delete(r); throw error })
      services.set(r, runtime)
    }
    return runtime
  }
  registerDesktopAiRoutes(ctx, runtimes, jobs, getRuntime)
  for (const channel of desktopBookCommands) ctx.app.post<{ Params: { bookId: string } }>(`/api/books/:bookId/desktop/${channel.replace(':', '/')}`, async request => {
    const current = ctx.write(request), id = uuid(request.params.bookId), input = record(request.body, ['args', 'operation'])
    if (!Array.isArray(input.args)) fail('invalid-request')
    const operationId = operation(input.operation)
    ctx.rate(`desktop-book:${current.user.id}`, 300)
    return runtimes.mutations.run(id, () => runtimes.run(current.user.id, id, async r => {
      const args = desktopPrivateArgs(input.args as unknown[], r.root, id)
      if (channel === 'assistant:recent-fields') {
        if (args.length !== 1 || args[0] !== id) fail('not-found')
        args[0] = r.root
      }
      if (!reads.has(channel)) await assertTenantSpace(ctx.db.root, current.user.id, id, Buffer.byteLength(JSON.stringify(args)) * 3 + 128 * 1024, readSite(ctx.db).limits)
      const runtime = await getRuntime(r)
      if (channel === 'imports:commit-text' || channel === 'imports:commit-manifest') {
        const form = record(args[0]), files = channel === 'imports:commit-text' ? [form] : form.files
        if (!Array.isArray(files)) fail('invalid-request')
        let count = 0
        for (const item of files) {
          const file = record(item)
          if (file.ownership !== 'owned') continue
          // Online imports must select their chapters explicitly, so quota
          // admission is checked before the original core commits any text.
          if (!Array.isArray(file.selectedChapterIndexes)) fail('invalid-request')
          count += file.selectedChapterIndexes.length
        }
        if (count + (await r.documents.chapters()).length > 500) fail('quota-exceeded')
      }
      const handler = runtime.handlers.get(channel)
      if (!handler) fail('internal-error')
      const scope = `desktop-create:${id}:${channel}`, fingerprint = digest(JSON.stringify(input.args))
      if (creates.has(channel)) {
        const previous = ctx.db.get('SELECT payload_hash,result FROM receipts WHERE scope=? AND operation=?', scope, operationId)
        if (previous) {
          if (previous.payload_hash !== fingerprint) fail('conflict')
          const receipt = record(JSON.parse(dbString(previous.result)))
          if (receipt.status !== 'complete') fail('conflict')
          return validateIpcResponse(channel, receipt.response)
        }
        if (channel === 'chapters:create' && (await r.documents.chapters()).length >= 500) fail('quota-exceeded')
        ctx.db.run('INSERT INTO receipts VALUES(?,?,?,?,?)', scope, operationId, fingerprint, JSON.stringify({ status: 'pending' }), ctx.db.now())
      }
      const result = desktopPublicValue(await handler(undefined, ...args), r.root, id)
      // Validate the same output contract as preload before crossing HTTP.
      const response = validateIpcResponse(channel, result)
      if (creates.has(channel)) ctx.db.run('UPDATE receipts SET result=? WHERE scope=? AND operation=?', JSON.stringify({ status: 'complete', response }), scope, operationId)
      return response
    }))
  })
  return getRuntime
}
