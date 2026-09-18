export type DesktopPetMode = 'detailed' | 'chibi' | 'hidden'
export interface DesktopPetContext {
  mode: DesktopPetMode
  scope: string
  taskId: string
  taskStatus: string
  quiet: boolean
  reducedMotion: boolean
  followPointer: boolean
  autoBlink: boolean
  stateFeedback: boolean
  intensity: number
  focusHidden: boolean
}
export interface DesktopPetPreferences {
  scale: number
  alwaysOnTop: boolean
  clickThrough: boolean
  reminderMinutes: number
}
export interface DesktopPetState {
  open: boolean
  context: DesktopPetContext
  preferences: DesktopPetPreferences
  position: { x: number; y: number } | null
  error: string | null
}
export type DesktopPetAction = 'return-to-writing' | 'settings' | 'mode-detailed' | 'mode-chibi'
export type DesktopPetCommand =
  | { type: 'toggle' | 'hide' | 'locate' | 'return-to-writing' | 'settings' | 'drag-start' | 'drag-end' }
  | { type: 'hover'; interactive: boolean }
  | { type: 'regions'; regions: Array<{ x: number; y: number; width: number; height: number }> }
  | { type: 'mode'; mode: 'detailed' | 'chibi' }
  | { type: 'configure'; preferences: DesktopPetPreferences }
export interface DesktopPetApi {
  get(): Promise<DesktopPetState>
  updateContext(context: DesktopPetContext): Promise<DesktopPetState>
  command(command: DesktopPetCommand): Promise<DesktopPetState>
  onState(listener: (state: DesktopPetState) => void): () => void
  onAction(listener: (action: DesktopPetAction) => void): () => void
}
