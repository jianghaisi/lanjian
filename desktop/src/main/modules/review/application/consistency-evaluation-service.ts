import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import {
  evaluateFixedConsistencySamples,
  parseSemanticEvaluationResponse,
  semanticEvaluationBatches,
  semanticEvaluationPrompt,
  type FixedEvaluationReport,
  type SemanticPredictions
} from '../domain/consistency-evaluation'
import { projectDirectory } from '../../../platform/storage/project-path'
import type { ConsistencyEvaluationJob, ConsistencyEvaluationSummary } from '../../../../contracts/index'
import { readJson, writeJson } from '../../../platform/storage/json-store'
import { completeStructured } from '../../assistant/application/structured-response-repair'
import type { PreparedAiCompletion } from '../../models/application/ai-client'

type EvaluationAi = {
  prepareCompletion: (task: 'review') => Promise<PreparedAiCompletion>
}

type EvaluationProjects = {
  currentPath: () => Promise<string>
}

type StoredEvaluation = {
  version: 1
  deliveryProtocol: 'anonymous-evidence-v1'
  connectionId: string
  workItemId: string
  summary: ConsistencyEvaluationSummary
  report: FixedEvaluationReport
  warnings: string[]
}

export class ConsistencyEvaluationService {
  constructor(
    private readonly ai: EvaluationAi,
    private readonly projects: EvaluationProjects,
    private readonly now = () => new Date(),
    private readonly repairAttempts: () => Promise<number> = async () => 1
  ) {}

  async latest(): Promise<ConsistencyEvaluationSummary | null> {
    const root = await this.projects.currentPath()
    const path = await this.reportPath(root)
    const stored = await readJson<StoredEvaluation | null>(path, null)
    return validStoredEvaluation(stored, root) ? stored.summary : null
  }

  async run(signal: AbortSignal, onProgress?: (completed: number, total: number, message: string) => void, expectedRoot?: string): Promise<ConsistencyEvaluationSummary> {
    const root = expectedRoot ?? await this.projects.currentPath()
    await this.assertActive(root, signal)
    const prepared = await this.ai.prepareCompletion('review')
    const modelVersion = prepared.model
    const repairAttempts = await this.repairAttempts()
    await this.assertActive(root, signal)
    const batches = semanticEvaluationBatches()
    const predictions: Record<string, string[]> = {}
    const warnings: string[] = []

    for (let index = 0; index < batches.length; index += 1) {
      if (signal.aborted) throw abortError()
      const batch = batches[index]
      onProgress?.(index, batches.length, `正在核对第 ${index + 1}/${batches.length} 组语义样本`)
      let parsed: Record<string, string[]> | null = null
      try {
        parsed = await completeStructured({
          ai: { complete: async (instruction, draft, context) => {
            await this.assertActive(root, signal)
            return prepared.complete(instruction, draft || '', context || '', signal)
          } }, instruction: semanticEvaluationPrompt(batch),
          systemContext: '你是中文长篇小说一致性样本分类器。只依据给定文本判断，不扩写小说，不修改作品，不进行题材之外的审查。证据不足时返回空 codes。',
          task: 'review', signal, model: modelVersion, repairAttempts,
          parse: (content) => {
            try { return parseSemanticEvaluationResponse(content, batch) }
            catch (error) { throw new AppError('AI_RESPONSE_INVALID', error instanceof Error ? error.message : '语义评测结果无效。', { recoverable: true }) }
          }
        })
      } catch (error) {
        if (signal.aborted || isAbort(error)) throw abortError()
        // Only a model response that reached us but failed the strict result
        // contract may be counted as "unable to judge". Connection, auth,
        // quota and other provider failures must stop after the first batch;
        // retrying the remaining fixed batches cannot repair that condition.
        if (!(error instanceof AppError) || error.code !== 'AI_RESPONSE_INVALID') throw error
        warnings.push(`第 ${index + 1} 组未得到可校验结果，已计入无法判断。`)
      }
      if (parsed) Object.assign(predictions, parsed)
      onProgress?.(index + 1, batches.length, parsed ? `第 ${index + 1} 组已完成` : `第 ${index + 1} 组无法判断`)
    }

    await this.assertActive(root, signal)
    const report = evaluateFixedConsistencySamples({ semanticPredictions: predictions satisfies SemanticPredictions, semanticModelVersion: modelVersion })
    const semanticMetrics = report.metrics.filter((metric) => metric.layer === 'semantic')
    const summary: ConsistencyEvaluationSummary = {
      version: 1,
      suite: report.suite,
      modelVersion,
      completedAt: this.now().toISOString(),
      reportRelativePath: '.webnovel/evaluations/consistency-fixed-v2.json',
      sampleCount: report.sampleCount,
      evaluatedCount: report.evaluatedCount,
      unableToJudgeCount: report.unableToJudgeCount,
      semanticSampleCount: semanticMetrics.reduce((total, metric) => total + metric.sampleCount, 0),
      semanticEvaluatedCount: semanticMetrics.reduce((total, metric) => total + metric.evaluatedCount, 0),
      semanticTruePositive: semanticMetrics.reduce((total, metric) => total + metric.truePositive, 0),
      semanticFalsePositive: semanticMetrics.reduce((total, metric) => total + metric.falsePositive, 0),
      semanticFalseNegative: semanticMetrics.reduce((total, metric) => total + metric.falseNegative, 0),
      semanticUnableToJudge: semanticMetrics.reduce((total, metric) => total + metric.unableToJudge, 0),
      warningCount: warnings.length
    }
    await writeJson(await this.reportPath(root), {
      version: 1, deliveryProtocol: 'anonymous-evidence-v1', connectionId: prepared.connectionId,
      workItemId: root, summary, report, warnings
    } satisfies StoredEvaluation, () => this.assertActive(root, signal))
    return summary
  }

  private async assertActive(root: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError()
    const current = await this.projects.currentPath()
    if (signal.aborted) throw abortError()
    if (resolve(current) !== resolve(root)) {
      throw new AppError('CONFLICT', '评测期间已切换作品，结果没有写入任何项目。', { recoverable: true })
    }
  }

  private async reportPath(root: string): Promise<string> {
    return projectDirectory(root, join(root, '.webnovel', 'evaluations', 'consistency-fixed-v2.json'))
  }
}

export class ConsistencyEvaluationJobService {
  private readonly jobs = new Map<string, { state: ConsistencyEvaluationJob; controller: AbortController }>()

  constructor(
    private readonly runner: ConsistencyEvaluationService,
    private readonly projects: EvaluationProjects,
    private readonly now = () => new Date()
  ) {}

  async start(): Promise<ConsistencyEvaluationJob> {
    const workItemId = await this.projects.currentPath()
    const active = [...this.jobs.values()].find((job) => job.state.workItemId === workItemId && job.state.status === 'running')
    if (active) return structured(active.state)
    const controller = new AbortController()
    const id = randomUUID()
    const state: ConsistencyEvaluationJob = {
      id, workItemId, status: 'running', completedBatches: 0, totalBatches: semanticEvaluationBatches().length,
      message: '正在准备固定语义样本', startedAt: this.now().toISOString()
    }
    this.jobs.set(id, { state, controller })
    void this.execute(id)
    return structured(state)
  }

  status(id: string): ConsistencyEvaluationJob {
    const job = this.jobs.get(id)
    if (!job) throw new AppError('NOT_FOUND', '没有找到这次一致性评测任务。', { recoverable: true })
    return structured(job.state)
  }

  cancel(id: string): ConsistencyEvaluationJob {
    const job = this.jobs.get(id)
    if (!job) throw new AppError('NOT_FOUND', '没有找到这次一致性评测任务。', { recoverable: true })
    if (job.state.status === 'running') job.controller.abort()
    return structured(job.state)
  }

  cancelAll(): void { for (const job of this.jobs.values()) if (job.state.status === 'running') job.controller.abort() }

  private async execute(id: string): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) return
    try {
      const result = await this.runner.run(job.controller.signal, (completedBatches, totalBatches, message) => {
        const current = this.jobs.get(id)
        if (current?.state.status === 'running') current.state = { ...current.state, completedBatches, totalBatches, message }
      }, job.state.workItemId)
      const current = this.jobs.get(id)
      if (current?.state.status === 'running') current.state = { ...current.state, status: 'completed', result, message: '固定一致性评测完成', completedAt: this.now().toISOString() }
    } catch (error) {
      const current = this.jobs.get(id)
      if (!current) return
      const cancelled = current.controller.signal.aborted || isAbort(error)
      current.state = {
        ...current.state,
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? '评测已停止，作品内容没有变化' : '评测未完成，作品内容没有变化',
        completedAt: this.now().toISOString(),
        ...(cancelled ? {} : { error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '一致性评测未完成，请检查模型连接后重试。' } })
      }
    }
  }
}

function validStoredEvaluation(value: StoredEvaluation | null, root: string): value is StoredEvaluation {
  return Boolean(value && value.version === 1 && resolve(value.workItemId) === resolve(root)
    && value.summary?.suite === 'consistency-fixed-v2' && value.summary.version === 1
    && typeof value.summary.modelVersion === 'string' && typeof value.summary.completedAt === 'string')
}

function structured<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError' }
function abortError(): DOMException { return new DOMException('评测已停止', 'AbortError') }
