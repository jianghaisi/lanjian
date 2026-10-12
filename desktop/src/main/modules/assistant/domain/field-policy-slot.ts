import type { CreativeSlot } from '@lanjian/writing-plugin-contracts'
import { storyOutlineFieldIds } from '../../../../contracts/planning/outline-story-guidance'

/** Finite host field routing; packages supply methods, never target or save capabilities. */
export function fieldPolicySlot(fieldId: string): CreativeSlot {
  if (fieldId.startsWith('ChronicleEvents.') || fieldId.startsWith('AppShell.eventDraft.')) return 'events'
  if (fieldId.startsWith('AppShell.storyEntityDraft.') || ['AppShell.item.name', 'AppShell.item.role', 'AppShell.item.arcSeed'].includes(fieldId)) return 'characters'
  if (storyOutlineFieldIds.has(fieldId)) return 'revision'
  if (fieldId.startsWith('Realm.') || fieldId.startsWith('AppShell.foundation.') || fieldId.startsWith('AppShell.powerSystem.')
    || fieldId.startsWith('AppShell.cheatSystem.') || fieldId === 'AppShell.systemTemplate') return 'foundation'
  return 'field-edit'
}
