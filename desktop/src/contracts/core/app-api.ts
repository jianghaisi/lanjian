import type { WritingAgentSkillId } from '../assistant/types'

export type DesktopAppApi = {
  version: () => Promise<string>
  onWindowShown: (listener: () => void) => () => void
  onBeforeClose: (listener: () => void) => () => void
  readyToClose: (success: boolean) => void
  showSelectionAiMenu: () => void
  onSelectionAiAction: (listener: (skill: WritingAgentSkillId) => void) => () => void
}
