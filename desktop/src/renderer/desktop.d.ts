import type { DesktopApi } from '../contracts/index'
import type { DesktopPetApi } from '../contracts/companion/desktop-pet'

declare global {
  interface Window { novelDesktop?: DesktopApi; desktopPet?: DesktopPetApi }
}

export {}
