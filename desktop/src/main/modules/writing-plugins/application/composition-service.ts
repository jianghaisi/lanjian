import { randomUUID } from 'node:crypto'
import { codePluginLimits, validateCompositionEntries, type CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import { inspectComposition, inspectLibraryComposition, type CompositionConflict } from '../domain/composition'
import type { WritingPluginManager } from './plugin-manager'

export type CompositionPreview = { planId: string; revision: number; entries: CompositionEntry[]; conflicts: CompositionConflict[] }
type CompositionScope = { kind: 'book'; bookId: string } | { kind: 'library' }
/** Plans are main-owned and single-use; the caller supplies an already captured scope check. */
export class PluginCompositionService {
  private readonly plans = new Map<string, { scope: CompositionScope; revision: number; entries: CompositionEntry[]; expires: number; check: () => Promise<void> }>()
  constructor(private readonly manager: WritingPluginManager) {}
  async preview(bookId: string, entries: CompositionEntry[], revision: number, check: () => Promise<void>): Promise<CompositionPreview> {
    return this.previewScope({ kind: 'book', bookId }, entries, revision, check)
  }
  async previewLibrary(entries: CompositionEntry[], revision: number, check: () => Promise<void>): Promise<CompositionPreview> {
    return this.previewScope({ kind: 'library' }, entries, revision, check)
  }
  private async previewScope(scope: CompositionScope, entries: CompositionEntry[], revision: number, check: () => Promise<void>): Promise<CompositionPreview> {
    await check()
    for (const [id, plan] of this.plans) if (plan.expires <= Date.now()) this.plans.delete(id)
    const index = await this.manager.list()
    if (index.revision !== revision || this.plans.size >= codePluginLimits.installationPlans) return this.conflict()
    const inspected = scope.kind === 'book' ? inspectComposition(index, scope.bookId, validateCompositionEntries(entries)) : inspectLibraryComposition(index, validateCompositionEntries(entries)), planId = randomUUID()
    await check()
    if (!inspected.conflicts.length) this.plans.set(planId, { scope, revision, entries: inspected.entries, expires: Date.now() + codePluginLimits.installationPlanMs, check })
    return { planId, revision, entries: inspected.entries, conflicts: inspected.conflicts }
  }
  async apply(planId: string): Promise<void> {
    const plan = this.plans.get(planId); this.plans.delete(planId)
    if (!plan || plan.expires <= Date.now()) return this.conflict()
    await plan.check()
    if (plan.scope.kind === 'book') await this.manager.applyComposition(plan.scope.bookId, plan.entries, plan.revision, plan.check)
    else await this.manager.applyLibraryComposition(plan.entries, plan.revision, plan.check)
  }
  private conflict(): never { throw new AppError('CONFLICT', '组合或预览已经变化，请刷新并重新预览。', { recoverable: true }) }
}
