import type { WritingAgentRequest } from '../../../../contracts/index'
import { AppError } from '../../../core/errors/app-error'
import type { ProjectService } from '../../library/application/project-service'
import type { WritingAgentService } from './writing-agent-service'

/** The single main editor's transient preview; persistent jobs own separate signals. */
export class WritingAgentPreviewService {
  private active?: AbortController
  private navigating = false

  constructor(
    private readonly projects: Pick<ProjectService, 'runInCurrentBook'>,
    private readonly agent: Pick<WritingAgentService, 'preview'>
  ) {}

  async preview(input: WritingAgentRequest) {
    if (this.navigating) throw previewConflict()
    this.cancel()
    // Establish ownership before capturing the book, which itself awaits filesystem reads.
    const controller = new AbortController()
    this.active = controller
    const { signal } = controller
    let stop!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      stop = () => reject(signal.reason)
      signal.addEventListener('abort', stop, { once: true })
    })
    try {
      return await Promise.race([
        this.projects.runInCurrentBook(async () => {
          signal.throwIfAborted()
          const result = await this.agent.preview(input, signal)
          signal.throwIfAborted()
          return result
        }),
        cancelled
      ])
    } finally {
      signal.removeEventListener('abort', stop)
      // An older completion must never clear the newer preview's controller.
      if (this.active === controller) this.active = undefined
    }
  }

  cancel(): void {
    this.active?.abort(previewConflict())
    this.active = undefined
  }

  beginNavigation(): void {
    this.navigating = true
    this.cancel()
  }

  endNavigation(): void {
    this.navigating = false
  }
}

function previewConflict() {
  return new AppError('CONFLICT', '本次上下文预览已失效，请在当前作品重新预览。', { recoverable: true })
}
