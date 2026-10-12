import { integer, maxCredits, type ProviderTokenPolicy, type ProviderTokenRates } from '@lanjian/hosted-contracts'
import type { ModelUsage } from '../models/usage.ts'
import { fail } from '../http/errors.ts'

const scale = 10n ** 15n
function decimal(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * scale + BigInt(fraction.padEnd(15, '0'))
}
function amount(policy: ProviderTokenPolicy, cost: bigint) {
  const numerator = cost * decimal(policy.groupMultiplier) * decimal(policy.usdToCny) * decimal(policy.pointsPerCny) * 1000n
  const denominator = 1_000_000n * scale ** 4n
  const units = (numerator + denominator - 1n) / denominator
  if (units < 0 || units > BigInt(maxCredits)) fail('invalid-request')
  return Number(units)
}
/** input is the entire context, including caches, even when selecting a tier. */
export function providerUsageCost(policy: ProviderTokenPolicy, usage: ModelUsage): number {
  integer(usage.input, 0, 100_000_000); integer(usage.output, 0, 100_000_000)
  const rates = policy.tiers.find(tier => tier.through === null || usage.input <= tier.through)!.rates
  let plain = usage.input, cost = BigInt(usage.output) * decimal(rates.output)
  let categories = 0
  for (const key of ['cacheRead', 'cacheWrite', 'cacheWrite1h', 'audioInput'] as const) {
    const tokens = integer(usage[key] ?? 0, 0, usage.input)
    categories += tokens
    if (rates[key] !== undefined) { plain -= tokens; cost += BigInt(tokens) * decimal(rates[key]!) }
  }
  if (categories > usage.input || plain < 0) fail('usage-unconfirmed')
  return amount(policy, cost + BigInt(plain) * decimal(rates.input))
}
/** Reserve enough for all accepted cache categories and context tiers. */
export function providerUsageBudget(policy: ProviderTokenPolicy, input: number, output: number): number {
  integer(input, 0, 100_000_000); integer(output, 0, 100_000_000)
  let worst = 0n
  for (const tier of policy.tiers) {
    const r = tier.rates, inputKeys: Array<keyof ProviderTokenRates> = ['input', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'audioInput']
    const maximum = inputKeys.reduce((before, key) => r[key] === undefined ? before : before > decimal(r[key]!) ? before : decimal(r[key]!), 0n)
    const cost = BigInt(input) * maximum + BigInt(output) * decimal(r.output)
    if (cost > worst) worst = cost
  }
  return amount(policy, worst)
}
