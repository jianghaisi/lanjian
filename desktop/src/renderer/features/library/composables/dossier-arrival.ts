import { shallowRef, type InjectionKey, type ShallowRef } from 'vue'

export interface DossierTarget { element: HTMLElement; projectId: string | null }
export interface DossierArrival { target: ShallowRef<DossierTarget | null>; concealed: ShallowRef<boolean>; feedbackAfter: ShallowRef<number> }
export const dossierArrivalKey: InjectionKey<DossierArrival> = Symbol('dossier-arrival')
export function createDossierArrival(): DossierArrival {
  return { target: shallowRef(null), concealed: shallowRef(false), feedbackAfter: shallowRef(0) }
}
