import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { canonicalDirectory, projectExistingPath, projectTargetPath } from '../../../platform/storage/project-path'
import type { EventMirrorPlan, EventMirrorPublisherPort } from '../domain/event-mirror'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import { EVENT_MIRROR_RELATIVE_PATH } from './event-mirror-plan'

/** Publishes only the committed unified projection. External bytes are a CAS
 * conflict and are never adopted as formal event data. */
export class LocalEventMirrorPublisher implements EventMirrorPublisherPort {
  async publish(scope: EventSnapshotScope, plan: EventMirrorPlan, guard: {
    recheck(): Promise<void>
    assertActive(): void
  }) {
    try {
      const root = await canonicalDirectory(scope.root)
      if (root !== scope.root) throw stale()
      await guard.recheck()
      const requested = join(root, ...EVENT_MIRROR_RELATIVE_PATH.split('/'))
      let target = await projectTargetPath(root, requested)
      const observedHash = await fileHash(root, target)
      if (observedHash === plan.contentHash) {
        return Object.freeze({ feedback: synced(), observedHash })
      }
      if (observedHash !== plan.expectedFileHash) {
        return Object.freeze({ feedback: conflict(), observedHash })
      }

      await mkdir(dirname(target), { recursive: true })
      target = await projectTargetPath(root, requested)
      await guard.recheck()
      await atomicWriteText(target, plan.content, async () => {
        await guard.recheck()
        await projectTargetPath(root, requested)
        const currentHash = await fileHash(root, target)
        if (currentHash !== observedHash) throw externalChange(currentHash)
      }, guard.assertActive)

      await guard.recheck()
      const publishedHash = await fileHash(root, target)
      if (publishedHash !== plan.contentHash) throw externalChange(publishedHash)
      return Object.freeze({ feedback: synced(), observedHash: publishedHash })
    } catch (error) {
      if (isExternalChange(error)) {
        const observedHash = typeof error.details?.observedHash === 'string' ? error.details.observedHash : null
        return Object.freeze({ feedback: conflict(), observedHash })
      }
      if (isAppError(error) && error.code === 'CONFLICT') throw error
      return Object.freeze({ feedback: failed(), observedHash: null })
    }
  }
}

async function fileHash(root: string, target: string): Promise<string | null> {
  let path: string
  try { path = await projectExistingPath(root, target) }
  catch (error) {
    if (missing(error)) return null
    throw error
  }
  const digest = createHash('sha256')
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path)
      stream.on('data', chunk => digest.update(chunk))
      stream.once('error', reject)
      stream.once('end', resolve)
    })
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  return digest.digest('hex')
}

function synced() { return Object.freeze({ status: 'synced', issue: 'none' } as const) }
function conflict() { return Object.freeze({ status: 'conflict', issue: 'external-change' } as const) }
function failed() { return Object.freeze({ status: 'failed', issue: 'storage-error' } as const) }

function stale(): AppError {
  return new AppError('CONFLICT', '事件可读副本所属作品已经变化，请重新同步。', {
    recoverable: true, details: { area: 'eventMirror', reason: 'stale' }
  })
}

function externalChange(observedHash: string | null): AppError {
  return new AppError('CONFLICT', '事件可读副本已被外部修改，已保留现有文件。', {
    recoverable: true, details: { area: 'eventMirror', reason: 'external-change', observedHash }
  })
}

function isExternalChange(error: unknown): error is AppError {
  return isAppError(error) && error.code === 'CONFLICT' && error.details?.area === 'eventMirror'
    && error.details.reason === 'external-change'
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
