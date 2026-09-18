export type CompanionDialogueAppearance = { opacity: number; fontSize: number; width: number; maxHeight: number; placement: 'auto' | 'above' | 'right' }
export const defaultDialogueAppearance: CompanionDialogueAppearance = { opacity: .78, fontSize: 16, width: 340, maxHeight: 260, placement: 'auto' }
export function normalizeDialogueAppearance(input: unknown): CompanionDialogueAppearance {
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const bound = (key: 'opacity' | 'fontSize' | 'width' | 'maxHeight', min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) ? Math.min(max, Math.max(min, v[key])) : defaultDialogueAppearance[key]
  return { opacity: bound('opacity', .35, 1), fontSize: bound('fontSize', 12, 24), width: bound('width', 220, 560), maxHeight: bound('maxHeight', 140, 420), placement: v.placement === 'above' || v.placement === 'right' ? v.placement : 'auto' }
}
