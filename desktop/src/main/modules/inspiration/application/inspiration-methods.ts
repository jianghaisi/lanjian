import { policyRecords, type PolicySource, type CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import { withCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { decodeCreativePolicySnapshot, assertReleasedCreativePolicy, type CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { creativePolicyContext } from '../../writing-plugins/domain/creative-policy-context'
import { withCreativePolicyRun } from '../../writing-plugins/application/creative-policy-execution'
import { withContributionSnapshot } from '../../writing-plugins/runtime/contribution-context'
import { decodeInspirationPolicyRecords } from '../../../../contracts/inspiration/validation'

export type InspirationMethods = {
  policy: CreativePolicyRun; snapshot: CreativePolicySnapshot; records: CreativePolicyRecord[]
  extract: PolicySource[]; summary: PolicySource[]
}
export function inspirationMethods(policy: CreativePolicyRun): InspirationMethods {
  const extract = structuredClone(policy.resolve('inspiration-extract'))
  const summary = structuredClone(policy.resolve('inspiration-summary'))
  if (!policy.snapshot) throw new AppError('FEATURE_UNAVAILABLE', '灵感方法缺少可核验的原版本快照，请核对资料组合。', { recoverable: true })
  const snapshot = decodeCreativePolicySnapshot(policy.snapshot())
  assertReleasedCreativePolicy(snapshot)
  if (snapshot.installed.length && !policy.withContext) throw new AppError('FEATURE_UNAVAILABLE', '灵感资料方法的原执行范围无法核验。', { recoverable: true })
  return { policy, snapshot, extract, summary, records: decodeInspirationPolicyRecords(policyRecords([...extract, ...summary])) }
}
export function assertInspirationProvenance(methods: InspirationMethods, records?: CreativePolicyRecord[]): void {
  if (!records || JSON.stringify(decodeInspirationPolicyRecords(records)) !== JSON.stringify(methods.records)) {
    throw new AppError('CONFLICT', '灵感任务的方法来源与原快照不符，原记录保留，请重新核对。', { recoverable: true })
  }
}
/** The library is an independent application/owner scope, never a fabricated book.
 * Clear inherited book contributions even when called by a book/group tool. */
export function runInInspirationMethods<T>(methods: InspirationMethods, operation: () => Promise<T>): Promise<T> {
  return withContributionSnapshot({ versions: [], composition: methods.snapshot.composition }, () => withCreativePolicy(methods.policy, () => {
    const run = () => withCreativePolicyRun(methods.policy, operation)
    return methods.policy.withContext ? methods.policy.withContext(run) : run()
  }))
}
export const inspirationMethodContext = (sources: PolicySource[]) => creativePolicyContext(sources)
