import type { WritingAgentSkillId } from '../assistant/types'

export type DesktopAppApi = {
  /** Explicit host capability; omitted by existing native clients. */
  platform?: 'desktop' | 'browser'
  hosted?: {
    readOnly?: boolean
    account: () => Promise<{ name: string; balance: number; reserved: number; admin: boolean }>
    logout: () => Promise<void>
    copyReference: () => Promise<string>
    /** Reading the public sample remains read-only even when this identity is signed in. */
    referenceSession?: () => Promise<{ authenticated: boolean }>

  }
  version: () => Promise<string>
  onWindowShown: (listener: () => void) => () => void
  onBeforeClose: (listener: () => void) => () => void
  readyToClose: (success: boolean) => void
  showSelectionAiMenu: () => void
  onSelectionAiAction: (listener: (skill: WritingAgentSkillId) => void) => () => void
}
