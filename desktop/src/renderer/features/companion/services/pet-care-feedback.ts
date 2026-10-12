import { petItems, petLevel, type PetCareAction, type PetCareState, type PetItem } from '../../../../contracts/companion/companion-care'

/** Availability is a hint from the last confirmed projection, not authorization. */
export function petItemDisabledReason(type: 'buy' | 'use', item: PetItem, state: PetCareState | undefined, enabled: boolean, busy: boolean): string {
  if (busy) return '正在处理，请稍候'
  if (!enabled) return '养成已暂停，请先在设置中开启'
  if (!state) return '正在读取伙伴档案'
  if (type === 'buy') {
    if (state.inventory[item] >= 999) return '这件物品已满 999 件，使用后再补充'
    if (state.coins < petItems[item].price) return `还差 ${petItems[item].price - state.coins} 星币，可完成照料目标或专注获得`
  } else {
    if (state.sleeping) return '正在休息，请先在照料页唤醒'
    if (!state.inventory[item]) return `没有${petItems[item].name}了，可到背包小铺补充`
    if (item === 'toy' && state.energy < 8) return '玩耍需要 8 点体力，先睡一会儿吧'
  }
  return ''
}

export function petAchievementProgress(state: PetCareState) {
  const entries: Array<{ id: PetCareState['achievements'][number]; label: string; requirement: string; value: number; target: number; unit: string }> = [
    { id: 'first-care', label: '第一份关心', requirement: '喂食一次', value: state.totals.fed, target: 1, unit: '次' },
    { id: 'playmate', label: '玩耍五次', requirement: '累计玩耍五次', value: state.totals.played, target: 5, unit: '次' },
    { id: 'focused', label: '专注同行', requirement: '完成一次专注', value: state.totals.focus, target: 1, unit: '次' },
    { id: 'growing', label: '一起成长', requirement: '伙伴达到 Lv.3', value: petLevel(state.experience), target: 3, unit: '级' },
  ]
  return entries.map(entry => ({ ...entry, value: Math.min(entry.value, entry.target), earned: state.achievements.includes(entry.id) }))
}

/** Presentation only; completion text is used after main acknowledges the action. */
export function petCareFeedback(action: PetCareAction): string {
  if (action.type === 'use') return `已使用${petItems[action.item].name}`
  if (action.type === 'buy') return `${petItems[action.item].name}已放入背包`
  return ({ pat: '收到摸摸', sleep: '正在休息', wake: '已唤醒', 'claim-daily': '已领取今日奖励',
    'focus-start': '开始陪你专注', 'focus-pause': '专注已暂停', 'focus-resume': '继续陪你专注', 'focus-cancel': '已结束本次专注' })[action.type]
}

export function petCareStatus(state: PetCareState | undefined, enabled: boolean): string {
  if (!enabled || !state) return ''
  if (state.sleeping) return '正在休息'
  return state.focus ? { running: '陪你专注', paused: '专注已暂停', complete: '这一段专注完成了' }[state.focus.status] : ''
}

export function petCareDisabledReason(id: string, state: { busy: boolean; careEnabled: boolean; careReady: boolean; sleeping: boolean; food: number; water: number }): string {
  if (state.busy) return '正在处理，请稍候'
  if (!['food', 'water', 'sleep'].includes(id)) return ''
  if (!state.careEnabled) return '请先在桌宠设置中开启养成'
  if (!state.careReady) return '照料档案尚未就绪，请打开背包重试'
  if (id === 'sleep') return '' // The same button wakes a sleeping pet.
  if (state.sleeping) return '正在休息，请先唤醒再照料'
  if (!state[id as 'food' | 'water']) return `背包里没有${petItems[id as 'food' | 'water'].name}，可以去背包补充`
  return ''
}
