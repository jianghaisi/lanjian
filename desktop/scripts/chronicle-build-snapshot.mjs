import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The callback must close its Electron process before returning or throwing.
export async function withChronicleBuildSnapshot(source, cache, run) {
  await mkdir(cache, { recursive: true })
  const parent = await realpath(cache)
  const snapshot = await mkdtemp(join(parent, 'chronicle-smoke-'))
  let failure
  try {
    await cp(source, join(snapshot, 'out'), { recursive: true })
    return await run(snapshot)
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      const target = await realpath(snapshot)
      if (target !== snapshot || dirname(target) !== parent) throw new Error('Unexpected chronicle snapshot path')
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (cleanupError) {
      if (failure !== undefined) throw new AggregateError([failure, cleanupError], 'Chronicle smoke and snapshot cleanup failed')
      throw cleanupError
    }
  }
}
