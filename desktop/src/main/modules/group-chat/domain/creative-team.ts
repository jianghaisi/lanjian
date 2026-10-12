import { createHash } from 'node:crypto'
import { resolveCreativeTeam, type CreativeTeam, type CreativeTeamSource } from '@lanjian/writing-plugin-contracts'
import { officialCreativePackageFor } from '@lanjian/writing-plugin-package/official'
import { AppError } from '../../../core/errors/app-error'
import { creativePolicyRun, type CaptureCreativePolicy, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import { restoreCreativePolicy, type CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'

export type GroupTeamOrigin = { policy: CreativePolicySnapshot; teamHash: string }
const fingerprint = (source: CreativeTeamSource) => createHash('sha256').update(JSON.stringify(source)).digest('hex')
const unavailable = (): never => { throw new AppError('FEATURE_UNAVAILABLE', '原讨论的创作团队无法核验，请保留记录并新建讨论。', { recoverable: true }) }
export function captureGroupTeam(policy: CreativePolicyRun = creativePolicyRun()): { team: CreativeTeam; origin: GroupTeamOrigin } {
  if (!policy.team || !policy.snapshot) return unavailable()
  const source = policy.team()
  return { team: structuredClone(source.team), origin: { policy: policy.snapshot(), teamHash: fingerprint(source) } }
}
export async function restoreGroupTeam(capture: CaptureCreativePolicy, origin: GroupTeamOrigin, team: CreativeTeam): Promise<CreativePolicyRun> {
  const policy = await restoreCreativePolicy(capture, origin.policy)
  if (!policy.team) return unavailable()
  const source = policy.team()
  if (fingerprint(source) !== origin.teamHash || JSON.stringify(source.team) !== JSON.stringify(team)) {
    throw new AppError('CONFLICT', '原讨论团队的版本或成员已变化，已有记录保留，请新建讨论。', { recoverable: true })
  }
  await policy.assertAuthorized?.()
  return policy
}
/** Exact historical metadata only. This single-package lookup cannot execute a legacy session. */
export function legacyGroupTeam(): CreativeTeam {
  const original = officialCreativePackageFor({ pluginId: 'lanjian.official.creative-team', version: '1.0.0', digest: '5dcd8ebfa63809c04e198fce6f9dca4e43182452d56c48e9e41ef4592075e4a6' })
  return resolveCreativeTeam([original], [], { revision: 0, entries: [] }).team
}
