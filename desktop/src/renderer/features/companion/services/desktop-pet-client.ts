import type { DesktopPetAction, DesktopPetApi, DesktopPetCommand, DesktopPetContext, DesktopPetState } from '../../../../contracts/companion/desktop-pet'

/** The dedicated pet entry has a narrow preload. No manuscript or provider API. */
function api(): DesktopPetApi {
  if (!window.desktopPet) throw new Error('桌面伙伴连接暂不可用，请从主窗口重新打开。')
  return window.desktopPet
}

export const desktopPetClient = {
  available: (): boolean => typeof window !== 'undefined' && Boolean(window.desktopPet),
  get: (): Promise<DesktopPetState> => api().get(),
  updateContext: (context: DesktopPetContext): Promise<DesktopPetState> => api().updateContext(context),
  command: (command: DesktopPetCommand): Promise<DesktopPetState> => api().command(command),
  onState: (listener: (state: DesktopPetState) => void): (() => void) => api().onState(listener),
  onAction: (listener: (action: DesktopPetAction) => void): (() => void) => api().onAction(listener)
}
