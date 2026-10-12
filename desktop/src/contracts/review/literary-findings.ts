import { boundedString, enumValue, invalid, record, rejectUnknown, requiredString } from '../core/validation'
import type { LiteraryFinding } from './types'

export const literaryFindingCategories = ['scene-motivation', 'character-voice', 'relationship-continuity', 'causal-gap', 'scene-function'] as const

/** Shared wire/storage shape; quote provenance is checked in the review application. */
export function decodeLiteraryFindings(value: unknown, path = 'literaryFindings'): LiteraryFinding[] {
  if (!Array.isArray(value) || value.length > 30) invalid(path, '必须是最多30项的问题列表')
  return value.map((raw, index) => {
    const field = `${path}[${index}]`, item = record(raw, field)
    rejectUnknown(item, field, ['category', 'severity', 'candidateQuote', 'sourceQuote', 'reason', 'correction'])
    const candidateQuote = boundedString(item.candidateQuote, `${field}.candidateQuote`, 5000)
    if (!candidateQuote.trim()) invalid(`${field}.candidateQuote`, '必须引用候选中的连续原句')
    return {
      category: enumValue(item.category, `${field}.category`, literaryFindingCategories),
      severity: enumValue(item.severity, `${field}.severity`, ['blocking', 'advice'] as const),
      candidateQuote,
      sourceQuote: boundedString(item.sourceQuote, `${field}.sourceQuote`, 5000),
      reason: requiredString(item.reason, `${field}.reason`, 2000),
      correction: requiredString(item.correction, `${field}.correction`, 2000)
    }
  })
}
