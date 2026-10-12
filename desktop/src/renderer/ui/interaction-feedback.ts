import type { InjectionKey } from 'vue'

export type InteractionCue = 'click' | 'confirm' | 'back' | 'navigate' | 'on' | 'off' | 'open' | 'close' | 'success' | 'warning' | 'error'
export interface InteractionFeedback { play: (cue: InteractionCue) => void }
export const interactionFeedbackKey: InjectionKey<InteractionFeedback> = Symbol('interaction-feedback')
