import { petItems, petLevel, type PetCareState, type PetCareRequest } from '../../../../contracts/companion/companion-care'
// Level/next-level and 0..100 clamp rules adapted from VPet GameSave.cs,
// LorisYounger et al., Apache-2.0, commit c24f712db51f92ff92e8546bb3e59364d4155d74.
// TS immutable transactions and light-care economy are local changes. See licenses/VPet-NOTICE.md.
export const boundPetStat = (value: number): number => Math.min(100, Math.max(0, value))
export function petDay(now: Date): string { return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` }
export function newPetCare(day: string): PetCareState {
  return { version:1,revision:0,hunger:75,thirst:75,energy:80,mood:75,affection:0,experience:0,coins:40,sleeping:false,inventory:{food:3,water:5,toy:2},daily:{day,fed:false,drank:false,played:false,claimed:false},totals:{fed:0,played:0,focus:0},achievements:[],focus:null,lastPat:0,receipts:[] }
}
function reward(state: PetCareState, xp: number, coins = 0) { state.experience = Math.min(1e9,state.experience+xp); state.coins = Math.min(1e6,state.coins+coins) }
function achievements(state: PetCareState) {
  const earn = (id: PetCareState['achievements'][number], condition: boolean) => { if (condition && !state.achievements.includes(id)) state.achievements.push(id) }
  earn('first-care',state.totals.fed>0); earn('playmate',state.totals.played>=5); earn('focused',state.totals.focus>0); earn('growing',petLevel(state.experience)>=3)
}
export function applyPetCare(before: PetCareState, input: PetCareRequest, now: Date): PetCareState {
  const fingerprint = JSON.stringify(input.action), receipt = before.receipts.find(item=>item.id===input.requestId)
  if (receipt) { if (receipt.action !== fingerprint) throw new Error('重复请求与原操作不同，请重试。'); return before }
  if (input.revision !== before.revision) throw new Error('伙伴状态已更新，请重试这次操作。')
  const state = structuredClone(before), day = petDay(now), action = input.action
  // Advancing date only: a clock rollback cannot create a second daily reward.
  if (day > state.daily.day) state.daily = {day,fed:false,drank:false,played:false,claimed:false}
  if (action.type === 'buy') {
    if (state.inventory[action.item] >= 999) throw new Error('背包里这件物品已经足够多了。')
    if (state.coins < petItems[action.item].price) throw new Error('星币不足，可以完成每日照料或专注活动获得。')
    state.coins -= petItems[action.item].price; state.inventory[action.item]++
  } else if (action.type === 'use') {
    if (state.sleeping) throw new Error('伙伴正在睡觉，请先轻轻叫醒。')
    if (!state.inventory[action.item]) throw new Error('背包里没有这件物品，可去小铺补充。')
    if (action.item === 'toy' && state.energy < 8) throw new Error('伙伴有点累了，先睡一会儿再玩吧。')
    state.inventory[action.item]--; state.affection = boundPetStat(state.affection+1)
    if (action.item === 'food') { state.hunger=boundPetStat(state.hunger+30); state.mood=boundPetStat(state.mood+3); state.daily.fed=true; state.totals.fed++; reward(state,8) }
    if (action.item === 'water') { state.thirst=boundPetStat(state.thirst+35); state.daily.drank=true; reward(state,5) }
    if (action.item === 'toy') { state.mood=boundPetStat(state.mood+25); state.energy-=8; state.daily.played=true; state.totals.played++; reward(state,10) }
  } else if (action.type === 'pat') {
    if (now.getTime()-state.lastPat >= 60000) { state.lastPat=now.getTime(); state.mood=boundPetStat(state.mood+2); state.affection=boundPetStat(state.affection+.5); reward(state,2) }
  } else if (action.type === 'sleep') { state.sleeping=true; if (state.focus?.status==='running') state.focus.status='paused' }
  else if (action.type === 'wake') state.sleeping=false
  else if (action.type === 'claim-daily') {
    if (state.daily.claimed || !state.daily.fed || !state.daily.drank || !state.daily.played) throw new Error('完成喂食、喝水和玩耍后，每天可领取一次奖励。')
    state.daily.claimed=true; reward(state,25,30)
  } else if (action.type === 'focus-start') {
    if (state.focus && state.focus.status!=='complete') throw new Error('请先结束或取消当前专注计时。')
    if (state.sleeping) throw new Error('伙伴睡着了，请先叫醒。')
    state.focus={id:input.requestId,duration:action.minutes*60,elapsed:0,status:'running'}
  } else if (action.type === 'focus-cancel') state.focus=null
  else if (action.type === 'focus-pause' || action.type === 'focus-resume') {
    if (!state.focus || state.focus.status==='complete') throw new Error('当前没有可继续的专注计时。')
    if (action.type==='focus-resume' && state.sleeping) throw new Error('伙伴睡着了，请先叫醒。')
    state.focus.status=action.type==='focus-pause'?'paused':'running'
  }
  achievements(state); state.revision++; state.receipts=[...state.receipts,{id:input.requestId,action:fingerprint}].slice(-128)
  return state
}
/** Monotonic online seconds only; long sleep gaps and offline time never accrue. */
export function advancePetCare(before: PetCareState, elapsed: number, day: string): PetCareState {
  if (!Number.isFinite(elapsed) || elapsed<=0 || elapsed>15) return before
  const state=structuredClone(before), minutes=elapsed/60
  if(day>state.daily.day)state.daily={day,fed:false,drank:false,played:false,claimed:false}
  if(state.sleeping) { state.energy=boundPetStat(state.energy+15*minutes);state.mood=boundPetStat(state.mood+2*minutes) }
  else { state.hunger=Math.max(10,state.hunger-.3*minutes);state.thirst=Math.max(10,state.thirst-.5*minutes);state.energy=Math.max(10,state.energy-.15*minutes);state.mood=Math.max(10,state.mood-.1*minutes) }
  if(state.focus?.status==='running') {
    state.focus.elapsed=Math.min(state.focus.duration,state.focus.elapsed+elapsed)
    if(state.focus.elapsed>=state.focus.duration) { state.focus.status='complete'; state.totals.focus++;reward(state,40,15);state.affection=boundPetStat(state.affection+2) }
  }
  achievements(state);state.revision++;return state
}
