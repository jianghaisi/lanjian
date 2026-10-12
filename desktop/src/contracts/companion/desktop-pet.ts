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
  positionLocked: boolean
  reminderMinutes: number
}
export type DesktopPetPanel = 'menu' | 'chat' | 'care' | 'settings'
/** Space (DIP) around the character for primary and nested menu rings. */
export const DESKTOP_PET_MENU_MARGIN = 132
export type DesktopPetRect = { x: number; y: number; width: number; height: number }
export type DesktopPetLayout = { pet: DesktopPetRect; panel: DesktopPetRect | null; side: 'left' | 'right' | null; kind: DesktopPetPanel | null }
export function decodeDesktopPetLayout(value: unknown): DesktopPetLayout {
  const invalid = () => { throw new Error('PET_LAYOUT_INVALID') }
  const record = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
    const item = value as Record<string, unknown>
    if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) return invalid()
    return item
  }
  const rect = (value: unknown): DesktopPetRect => {
    const item = record(value, ['x', 'y', 'width', 'height'])
    for (const [key, value] of Object.entries(item)) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 4096 || ((key === 'width' || key === 'height') && value === 0)) invalid()
    return { x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number }
  }
  const item = record(value, ['pet', 'panel', 'side', 'kind'])
  if (item.kind === null) {
    if (item.side !== null || item.panel !== null) return invalid()
    return { pet: rect(item.pet), panel: null, side: null, kind: null }
  }
  if (typeof item.kind !== 'string' || !['menu', 'chat', 'care', 'settings'].includes(item.kind) || (item.side !== 'left' && item.side !== 'right')) return invalid()
  return { pet: rect(item.pet), panel: rect(item.panel), side: item.side, kind: item.kind as DesktopPetPanel }
}
export interface DesktopPetState {
  open: boolean
  enabled?: boolean
  context: DesktopPetContext
  preferences: DesktopPetPreferences
  position: { x: number; y: number } | null
  error: string | null
  layout?: DesktopPetLayout
}
export type DesktopPetMotion = { dragging: boolean; velocityX: number; sequence: number }
export function decodeDesktopPetMotion(value: unknown): DesktopPetMotion {
  if (!value || typeof value !== 'object') throw new Error('PET_MOTION_INVALID')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== 3 || typeof item.dragging !== 'boolean' || typeof item.velocityX !== 'number' || !Number.isFinite(item.velocityX) || Math.abs(item.velocityX) > 4000 || !Number.isSafeInteger(item.sequence) || Number(item.sequence) < 0) throw new Error('PET_MOTION_INVALID')
  return { dragging: item.dragging, velocityX: item.velocityX, sequence: Number(item.sequence) }
}
export type DesktopPetAction = 'return-to-writing' | 'settings' | 'mode-detailed' | 'mode-chibi'
export type DesktopPetCommand =
  | { type: 'toggle' | 'hide' | 'locate' | 'recover-settings' | 'return-to-writing' | 'settings' | 'drag-start' | 'drag-end' }
  | { type: 'hover'; interactive: boolean }
  | { type: 'enable'; enabled: boolean }
  | { type: 'interaction'; busy: boolean }
  | { type: 'panel'; panel: DesktopPetPanel | null }
  | { type: 'pointer-press'; pressed: boolean }
  | { type: 'regions'; regions: Array<{ x: number; y: number; width: number; height: number }> }
  | { type: 'mode'; mode: 'detailed' | 'chibi' }
  | { type: 'configure'; preferences: DesktopPetPreferences }
export interface DesktopPetApi {
  get(): Promise<DesktopPetState>
  updateContext(context: DesktopPetContext): Promise<DesktopPetState>
  command(command: DesktopPetCommand): Promise<DesktopPetState>
  onState(listener: (state: DesktopPetState) => void): () => void
  onAction(listener: (action: DesktopPetAction) => void): () => void
  onMotion?(listener: (motion: DesktopPetMotion) => void): () => void
}
