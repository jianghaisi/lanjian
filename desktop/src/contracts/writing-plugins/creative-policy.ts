import { validatePolicyRecords, type CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import { invalid } from '../core/validation'

export function decodeCreativePolicyRecords(value: unknown): CreativePolicyRecord[] {
  try { return validatePolicyRecords(value) }
  catch { return invalid('creativePolicy', '创作方法来源格式无效') }
}
