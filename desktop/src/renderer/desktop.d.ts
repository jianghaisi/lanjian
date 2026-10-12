import type { DesktopApi } from '../contracts/index'
import type { DesktopPetApi } from '../contracts/companion/desktop-pet'
import type { CompanionVoiceApi } from '../contracts/companion/companion-voice-contracts'
import type { CompanionSettingsApi } from '../contracts/companion/companion-settings'
import type { CompanionAsrApi } from '../contracts/companion/companion-asr'
import type { CompanionCareApi } from '../contracts/companion/companion-care'

declare global {
  interface Window { novelDesktop?: DesktopApi; desktopPet?: DesktopPetApi; petVoice?: CompanionVoiceApi; companionSettings?: CompanionSettingsApi; companionAsr?: CompanionAsrApi; companionCare?: CompanionCareApi }
}

export {}
