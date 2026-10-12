import { operation, record, uuid } from '@lanjian/hosted-contracts'
import { unwrapValidatedIpcResponse, validateIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import type { desktopServices } from '../writing/desktop-services.ts'
import type { BookRuntime, BookRuntimes } from '../writing/book-runtime.ts'
import type { HostedJobs } from '../tasks/jobs.ts'
import type { WritingRouteContext } from './writing-routes.ts'
import { desktopPrivateArgs, desktopPublicValue } from '../writing/desktop-values.ts'
import { fail } from './errors.ts'

type Runtime = Awaited<ReturnType<typeof desktopServices>>
const asyncCommands: Record<string, [string, string]> = {
  'ai:start-writing-agent': ['ai:writing-agent-task', 'ai:cancel-writing-agent-task'],
  'ai:resume-writing-agent-task': ['ai:writing-agent-task', 'ai:cancel-writing-agent-task'],
  'ai:retry-writing-agent-task': ['ai:writing-agent-task', 'ai:cancel-writing-agent-task'],
  'planning:start': ['planning:job', 'planning:cancel'],
  'planning:start-chapter-skeleton': ['planning:chapter-skeleton-job', 'planning:cancel-chapter-skeleton'],
  'planning:start-chapter-detail': ['planning:chapter-detail-job', 'planning:cancel-chapter-detail'],
  'workspace:start-idea-generation': ['workspace:idea-generation', 'workspace:cancel-idea-generation'],
  'workspace:retry-idea-generation': ['workspace:idea-generation', 'workspace:cancel-idea-generation'],
  'workspace:start-outline-expansion': ['outline-expansion-internal', 'workspace:cancel-outline-expansion'],
  'workspace:retry-outline-expansion': ['outline-expansion-internal', 'workspace:cancel-outline-expansion'],
  'workspace:start-fact-extraction': ['workspace:fact-extraction-job', 'workspace:cancel-fact-extraction'],
  'workspace:retry-fact-extraction': ['workspace:fact-extraction-job', 'workspace:cancel-fact-extraction'],
  'ai:start-consistency-evaluation': ['ai:consistency-evaluation-job', 'ai:cancel-consistency-evaluation'],
  'events:settlement-start': ['events:settlement-task', 'events:settlement-stop'],
  'annotation-revision:start': ['annotation-revision:status', 'annotation-revision:cancel'],
  'annotation-revision:resume': ['annotation-revision:status', 'annotation-revision:cancel'],
  'annotation-revision:answer': ['annotation-revision:status', 'annotation-revision:cancel'],
  'assistant:start-field': ['assistant:field-task', 'assistant:cancel-field'],
  'assistant-runs:start': ['assistant-runs:status', 'assistant-runs:cancel'],
  'assistant-runs:resume': ['assistant-runs:status', 'assistant-runs:cancel'],
  'author-interactions:answer': ['assistant-runs:status', 'assistant-runs:cancel']
}
const synchronous = ['planning:generate-chapter-story', 'planning:prepare-chapter-story-contract', 'ai:complete', 'ai:run-writing-agent', 'ai:preview-writing-agent-context', 'workspace:generate-foundation-draft',
  'events:model-candidates-generate', 'imports:generate-continuation-analysis', 'annotation-revision:analyze', 'assistant:conversation']

export function registerDesktopAiRoutes(ctx: WritingRouteContext, runtimes: BookRuntimes, jobs: HostedJobs, getRuntime: (r: BookRuntime) => Promise<Runtime>) {
  for (const channel of [...Object.keys(asyncCommands), ...synchronous]) ctx.app.post<{ Params: { bookId: string } }>(`/api/books/:bookId/desktop/${channel.replace(':', '/')}`, async request => {
    const owner = ctx.write(request).user.id, id = uuid(request.params.bookId), input = record(request.body, ['args', 'operation'])
    if (!Array.isArray(input.args)) fail('invalid-request')
    const raw = input.args, first = raw[0], semantic = first && typeof first === 'object' && 'operationId' in first ? first.operationId
      : first && typeof first === 'object' && 'answerSubmissionId' in first ? first.answerSubmissionId
      : channel.includes('retry-') || channel === 'ai:resume-writing-agent-task' ? raw[1] : undefined
    const key = operation(semantic ?? input.operation)
    ctx.rate(`desktop-ai:${owner}`, 60)
    return jobs.desktop(owner, id, channel, raw, key, async (r, scope) => {
      const runtime = await getRuntime(r), args = desktopPrivateArgs(raw, r.root, id)
      // One-off controls are unavailable online. Reject stale/tampered choices
      // before invoking the original service, including choices in nested requests.
      const check = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value)) { value.forEach(check); return }
        const item = value as Record<string, unknown>
        for (const [name, field] of Object.entries(item)) {
          if (name === 'model' && field && field !== scope.model.model) fail('invalid-request')
          if (['connectionId', 'modelConnectionId'].includes(name) && field && ![scope.model.id, `global:${'global-hosted-' + scope.model.id}`].includes(String(field))) fail('invalid-request')
          if (name === 'apiKey' || name === 'baseUrl') fail('invalid-request')
          if (name === 'maxTokensOverride' && field !== undefined) fail('invalid-request')
          if (typeof field === 'object') check(field)
        }
      }
      args.forEach(check)
      const call = async (name: string, values: unknown[]) => {
        const handler = runtime.handlers.get(name)
        if (!handler) fail('internal-error')
        return unwrapValidatedIpcResponse<unknown>(name, await handler(undefined, ...values))
      }
      const value = await call(channel, args), response = validateIpcResponse(channel, { ok: true, value: desktopPublicValue(value, r.root, id) })
      const pair = asyncCommands[channel]
      if (!pair) return { response }
      const task = record(value), taskId = uuid(channel === 'author-interactions:answer' ? task.runId : task.id)
      const read = async () => pair[0] === 'outline-expansion-internal' ? runtime.outlineExpansions.status(taskId) : call(pair[0], [taskId])
      return { response, taskId,
        poll: async () => { const state = record(await read()); return { status: String(state.status), candidate: Boolean(state.artifact || state.candidate || state.proposal || state.result || state.turn || state.partial) } },
        stop: async () => {
          if (pair[1] === 'assistant-runs:cancel') { const current = record(await read()); return call(pair[1], [{ runId: taskId, expectedRevision: current.revision }]) }
          return call(pair[1], [taskId])
        }
      }
    })
  })
}
