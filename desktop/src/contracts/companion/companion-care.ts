import { companionRecord } from './companion-settings'
export const petItems = {
  food: { name: '桂花糕', price: 8, description: '饱食 +30，心情 +3', icon: '糕' },
  water: { name: '清泉水', price: 2, description: '饮水 +35', icon: '水' },
  toy: { name: '纸风车', price: 10, description: '心情 +25，体力 −8', icon: '玩' },
} as const
export type PetItem = keyof typeof petItems
export type PetCareAction = { type: 'buy' | 'use'; item: PetItem } | { type: 'pat' | 'sleep' | 'wake' | 'claim-daily' | 'focus-pause' | 'focus-resume' | 'focus-cancel' } | { type: 'focus-start'; minutes: 5 | 15 | 25 | 45 | 60 }
export type PetCareRequest = { requestId: string; revision: number; action: PetCareAction }
export type PetFocus = { id: string; duration: number; elapsed: number; status: 'running' | 'paused' | 'complete' }
export type PetCareState = {
  version: 1; revision: number; hunger: number; thirst: number; energy: number; mood: number; affection: number; experience: number; coins: number; sleeping: boolean
  inventory: Record<PetItem, number>
  daily: { day: string; fed: boolean; drank: boolean; played: boolean; claimed: boolean }
  totals: { fed: number; played: number; focus: number }
  achievements: Array<'first-care' | 'playmate' | 'focused' | 'growing'>
  focus: PetFocus | null; lastPat: number
  receipts: Array<{ id: string; action: string }>
}
export type CompanionCareApi = { get(): Promise<PetCareState>; act(input: PetCareRequest): Promise<PetCareState>; recover(): Promise<PetCareState>; onChange(listener: (state: PetCareState) => void): () => void; onError(listener: (error: string) => void): () => void }
// VPet GameSave.cs level progression; Apache-2.0, see licenses/VPet-NOTICE.md.
export const petLevel = (experience: number): number => experience < 0 ? 1 : Math.floor(Math.sqrt(experience) / 10) + 1
export const petNextLevel = (experience: number): number => (petLevel(experience) * 10) ** 2
export function decodePetCareRequest(value: unknown): PetCareRequest {
  const input = companionRecord(value, ['requestId','revision','action'])
  if (typeof input.requestId !== 'string' || !/^[\da-f-]{36}$/i.test(input.requestId) || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new Error('PET_CARE_REQUEST')
  if (!input.action || typeof input.action !== 'object') throw new Error('PET_CARE_ACTION')
  const type = (input.action as Record<string,unknown>).type
  if (type === 'use' || type === 'buy') {
    const action = companionRecord(input.action, ['type','item'])
    if (!['food','water','toy'].includes(String(action.item))) throw new Error('PET_CARE_ITEM')
  } else if (type === 'focus-start') {
    const action = companionRecord(input.action, ['type','minutes'])
    if (![5,15,25,45,60].includes(action.minutes as number)) throw new Error('PET_FOCUS_DURATION')
  } else {
    companionRecord(input.action, ['type'])
    if (!['pat','sleep','wake','claim-daily','focus-pause','focus-resume','focus-cancel'].includes(String(type))) throw new Error('PET_CARE_ACTION')
  }
  return input as PetCareRequest
}
const numberIn = (value: unknown, max: number, integer = false) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && (!integer || Number.isSafeInteger(value))
export function decodePetCareState(value: unknown): PetCareState {
  const input = companionRecord(value, ['version','revision','hunger','thirst','energy','mood','affection','experience','coins','sleeping','inventory','daily','totals','achievements','focus','lastPat','receipts'])
  if (input.version !== 1 || !numberIn(input.revision, Number.MAX_SAFE_INTEGER, true) || typeof input.sleeping !== 'boolean' || !numberIn(input.lastPat, Number.MAX_SAFE_INTEGER)) throw new Error('PET_CARE_FILE')
  for (const key of ['hunger','thirst','energy','mood','affection']) if (!numberIn(input[key],100)) throw new Error('PET_CARE_STAT')
  if (!numberIn(input.experience,1e9,true) || !numberIn(input.coins,1e6,true)) throw new Error('PET_CARE_BALANCE')
  const inventory = companionRecord(input.inventory,['food','water','toy'])
  for (const item of ['food','water','toy']) if (!numberIn(inventory[item],999,true)) throw new Error('PET_CARE_INVENTORY')
  const daily = companionRecord(input.daily,['day','fed','drank','played','claimed'])
  if (typeof daily.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(daily.day) || ['fed','drank','played','claimed'].some(key => typeof daily[key] !== 'boolean')) throw new Error('PET_CARE_DAILY')
  const totals = companionRecord(input.totals,['fed','played','focus'])
  for (const key of ['fed','played','focus']) if (!numberIn(totals[key],1e9,true)) throw new Error('PET_CARE_TOTAL')
  if (!Array.isArray(input.achievements) || input.achievements.length > 4 || new Set(input.achievements).size !== input.achievements.length || input.achievements.some(key => !['first-care','playmate','focused','growing'].includes(String(key)))) throw new Error('PET_CARE_ACHIEVEMENT')
  if (input.focus !== null) {
    const focus = companionRecord(input.focus,['id','duration','elapsed','status'])
    if (typeof focus.id !== 'string' || !/^[\da-f-]{36}$/i.test(focus.id) || ![300,900,1500,2700,3600].includes(Number(focus.duration)) || !numberIn(focus.elapsed,Number(focus.duration)) || !['running','paused','complete'].includes(String(focus.status)) || (focus.status === 'complete' && focus.elapsed !== focus.duration)) throw new Error('PET_CARE_FOCUS')
  }
  if (!Array.isArray(input.receipts) || input.receipts.length > 128) throw new Error('PET_CARE_RECEIPTS')
  for (const receipt of input.receipts) { const item = companionRecord(receipt,['id','action']); if (typeof item.id !== 'string' || !/^[\da-f-]{36}$/i.test(item.id) || typeof item.action !== 'string' || item.action.length > 100) throw new Error('PET_CARE_RECEIPT') }
  return input as PetCareState
}
