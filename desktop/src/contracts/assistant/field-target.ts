import { AppError } from '../core/app-error'
import { assistantFieldCatalog } from './assistant-field-catalog'
import type { FieldTarget, FieldValue } from './field-assistant-contracts'

export function fieldSpec(id: string) {
  if (!Object.hasOwn(assistantFieldCatalog, id)) throw new AppError('VALIDATION_ERROR', '这个输入内容不能由智能助笔修改。', { recoverable: true })
  return assistantFieldCatalog[id]
}
export function validateFieldValue(target: FieldTarget, value: unknown): FieldValue {
  const spec = fieldSpec(target.fieldId)
  const invalid = () => { throw new AppError('AI_RESPONSE_INVALID', `修改结果不符合“${spec.label}”的输入要求，请调整要求后重试。`, { recoverable: true }) }
  if (spec.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return invalid()
    if (spec.step && Math.abs((value - (spec.min || 0)) / spec.step - Math.round((value - (spec.min || 0)) / spec.step)) > 0.000001) return invalid()
  } else if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') return invalid()
  } else if (spec.kind === 'enum') {
    const options = spec.options || target.options
    if (!options?.length || !options.includes(value as FieldValue)) return invalid()
  } else {
    if (typeof value !== 'string' || value.length > (spec.maxLength || 100000)) return invalid()
    if (spec.kind === 'json') {
      try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object') return invalid() } catch { return invalid() }
    }
  }
  return value as FieldValue
}
export function sameFieldSnapshot(a: FieldTarget, b: FieldTarget) {
  return a.fieldId === b.fieldId && a.instanceId === b.instanceId && a.editorSessionId === b.editorSessionId && a.workItemId === b.workItemId && a.pageId === b.pageId && a.revision === b.revision && a.value === b.value && JSON.stringify(a.options || []) === JSON.stringify(b.options || [])
}
