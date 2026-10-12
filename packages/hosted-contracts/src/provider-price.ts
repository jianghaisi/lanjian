import { ContractError, integer, record, text } from './validation.js'

/** Decimal strings retain upstream prices without floating-point money rounding. */
export const tokenRateKeys = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'audioInput'] as const
export type TokenRateKey = typeof tokenRateKeys[number]
export type ProviderTokenRates = { input: string; output: string } & Partial<Record<TokenRateKey, string>>
export type ProviderTokenTier = { name: string; through: number | null; rates: ProviderTokenRates }
export type ProviderTokenPolicy = {
  mode: 'provider-tokens'; currency: 'USD'; usdToCny: string; pointsPerCny: string
  groupName: string; groupMultiplier: string; sourceVersion: string; tiers: ProviderTokenTier[]
}
export function priceDecimal(value: unknown, maximum = 1_000_000_000): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(\.\d{1,15})?$/.test(value) || Number(value) > maximum) throw new ContractError()
  return value
}
export function decodeProviderTokenPolicy(value: unknown): ProviderTokenPolicy {
  const p = record(value, ['mode', 'currency', 'usdToCny', 'pointsPerCny', 'groupName', 'groupMultiplier', 'sourceVersion', 'tiers'])
  if (p.mode !== 'provider-tokens' || p.currency !== 'USD' || !Array.isArray(p.tiers) || !p.tiers.length || p.tiers.length > 8) throw new ContractError()
  const usdToCny = priceDecimal(p.usdToCny, 1000), pointsPerCny = priceDecimal(p.pointsPerCny, 100_000)
  if (Number(usdToCny) === 0 || Number(pointsPerCny) === 0) throw new ContractError()
  let previous = 0
  const tiers = p.tiers.map((raw, index): ProviderTokenTier => {
    const tier = record(raw, ['name', 'through', 'rates'])
    const through = tier.through === null ? null : integer(tier.through, previous + 1, 100_000_000)
    if ((through === null) !== (index === (p.tiers as unknown[]).length - 1)) throw new ContractError()
    if (through !== null) previous = through
    const rawRates = record(tier.rates, tokenRateKeys), rates: ProviderTokenRates = {
      input: priceDecimal(rawRates.input), output: priceDecimal(rawRates.output)
    }
    for (const key of tokenRateKeys) if (rawRates[key] !== undefined) rates[key] = priceDecimal(rawRates[key])
    return { name: text(tier.name, 80), through, rates }
  })
  return { mode: 'provider-tokens', currency: 'USD', usdToCny, pointsPerCny,
    groupName: text(p.groupName, 80), groupMultiplier: priceDecimal(p.groupMultiplier, 1000), sourceVersion: text(p.sourceVersion, 128), tiers }
}
