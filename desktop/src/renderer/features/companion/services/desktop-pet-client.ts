import type { DesktopPetAction, DesktopPetApi, DesktopPetCommand, DesktopPetContext, DesktopPetState } from '../../../../contracts/companion/desktop-pet'
import { decodeDesktopPetLayout } from '../../../../contracts/companion/desktop-pet'

/** The dedicated pet entry has a narrow preload. No manuscript or provider API. */
function api(): DesktopPetApi {
  if (!window.desktopPet) throw new Error('桌面伙伴连接暂不可用，请从主窗口重新打开。')
  return window.desktopPet
}
function layoutState(state: DesktopPetState): DesktopPetState {
  return state.layout === undefined ? state : { ...state, layout: decodeDesktopPetLayout(state.layout) }
}

export const desktopPetClient = {
  available: (): boolean => typeof window !== 'undefined' && Boolean(window.desktopPet),
  get: (): Promise<DesktopPetState> => api().get().then(layoutState),
  updateContext: (context: DesktopPetContext): Promise<DesktopPetState> => api().updateContext(context).then(layoutState),
  command: (command: DesktopPetCommand): Promise<DesktopPetState> => api().command(command).then(layoutState),
  onState: (listener: (state: DesktopPetState) => void): (() => void) => api().onState(state => { try { listener(layoutState(state)) } catch { /* Invalid layout cannot resize the view; keep the last confirmed projection. */ } }),
  onAction: (listener: (action: DesktopPetAction) => void): (() => void) => api().onAction(listener)
}
