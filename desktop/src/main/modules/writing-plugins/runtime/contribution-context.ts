import { AsyncLocalStorage } from 'node:async_hooks'
import type { PluginComposition, WritingStage } from '@lanjian/writing-plugin-contracts'
import type { InstalledVersion } from '../domain/installed'
import { pinnedContributionContext } from '../adapters/contribution-adapters'

type Snapshot = { versions: InstalledVersion[]; composition: PluginComposition }
const execution = new AsyncLocalStorage<Snapshot>()
export function currentContributionSnapshot(): Snapshot | undefined { return execution.getStore() }
export function withContributionSnapshot<T>(snapshot: Snapshot, operation: () => Promise<T>): Promise<T> { return execution.run(snapshot, operation) }
/** Nested domain candidates inherit the originating run, never the edited composition. */
export function createContributionContextProvider(capture: () => Promise<Snapshot>) {
  return async (stage: WritingStage) => {
    const snapshot = execution.getStore() ?? await capture()
    return pinnedContributionContext(snapshot.versions, snapshot.composition, stage)
  }
}
