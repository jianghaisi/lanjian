<script setup lang="ts">
import { computed, ref } from 'vue'
import { petItems, petLevel, petNextLevel, type PetCareAction, type PetCareState, type PetItem } from '../../../../contracts/companion/companion-care'
import { useCompanionSettings } from '../composables/use-companion-settings'
import { usePetFocusClock } from '../composables/use-pet-focus-clock'
import { petAchievementProgress, petItemDisabledReason } from '../services/pet-care-feedback'
const props=defineProps<{state?:PetCareState;busy:boolean;error:string;initial?:'care'|'focus'}>()
const emit=defineEmits<{act:[action:PetCareAction];close:[];retry:[];reload:[];settings:[];dice:[];inspiration:[]}>()
const {settings,update}=useCompanionSettings(),tab=ref<'care'|'bag'|'growth'|'focus'>(props.initial??'care'),minutes=ref<5|15|25|45|60>(25)
const level=computed(()=>petLevel(props.state?.experience??0)),title=computed(()=>level.value>=3?'知己':level.value>=2?'同行':'初见')
const stats=[['hunger','饱食'],['thirst','饮水'],['energy','体力'],['mood','心情'],['affection','好感']] as const
const badges=computed(()=>props.state?petAchievementProgress(props.state):[])
const itemReason=(type:'buy'|'use',item:PetItem)=>petItemDisabledReason(type,item,props.state,settings.value.careEnabled,props.busy)
const missingItems=computed(()=>items.filter(([key])=>props.state&&!props.state.inventory[key]).map(([,item])=>item.name).join('、'))
const dailyGoals=computed(()=>[
  {label:'喂食',done:!!props.state?.daily.fed},
  {label:'喝水',done:!!props.state?.daily.drank},
  {label:'玩耍',done:!!props.state?.daily.played},
])
const remainingGoals=computed(()=>dailyGoals.value.filter(goal=>!goal.done).map(goal=>goal.label))
const focusClock=usePetFocusClock(computed(()=>props.state?.focus),computed(()=>settings.value.careEnabled&&!props.error&&tab.value==='focus'))
const focusStatus=computed(()=>{
  if(props.state?.focus?.status==='complete')return '已完成 · 15 星币与 40 经验已入账'
  if(!settings.value.careEnabled)return '养成已暂停，计时也已暂停'
  if(props.error)return '计时暂时无法同步，请先处理上方提示'
  if(props.state?.sleeping)return '伙伴正在休息，唤醒后可继续'
  if(props.state?.focus?.status==='paused')return '已暂停，准备好再继续'
  return focusClock.waiting.value?'正在同步计时…':'计时中 · 写完这一小段'
})
const items=Object.entries(petItems) as Array<[PetItem,(typeof petItems)[PetItem]]>
</script>
<template>
  <section class="care-panel" data-pet-interactive data-testid="pet-care-panel" aria-label="伙伴的日常">
    <header><div><h2>伙伴的日常 <em>{{ title }}</em></h2></div><button type="button" aria-label="关闭照料面板" @click="emit('close')">×</button></header>
    <nav aria-label="养成面板"><button v-for="(label,key) in {care:'照料',bag:'背包 · 小铺',growth:'成长',focus:'活动'}" :key="key" type="button" :aria-pressed="tab===key" @click="tab=key">{{ label }}</button></nav>
    <div v-if="error" class="care-error" role="alert"><p>{{ error }}</p><button type="button" :disabled="busy" @click="emit('retry')">重试操作</button><button type="button" :disabled="busy" @click="emit('reload')">重新读取</button><button type="button" @click="emit('settings')">设置与恢复 ↗</button></div>
    <div class="care-scroll">
    <p v-if="!settings.careEnabled" class="notice">养成已暂停，档案会为你保留。<button type="button" @click="emit('settings')">去设置开启 ↗</button></p>
    <template v-if="state">
      <div class="balance"><span>Lv. {{ level }} · {{ state.sleeping?'梦里也有故事':'今天也一起慢慢来' }}</span><b>✦ {{ state.coins }} 星币</b></div>
      <div v-if="settings.careEnabled&&(tab==='care'||tab==='bag')&&(state.sleeping||state.energy<8)" class="care-hint" data-testid="pet-rest-guidance">
        <p>{{ state.sleeping?'伙伴正在休息，唤醒后可以继续照料。':'玩耍需要 8 点体力，先让伙伴睡一会儿。' }}</p>
        <button v-if="tab==='bag'" type="button" @click="tab='care'">去照料{{ state.sleeping?'唤醒':'休息' }}</button>
      </div>
      <template v-if="tab==='care'">
        <div class="stats"><label v-for="[key,label] in stats" :key="key"><span>{{ label }}<b>{{ Math.round(state[key]) }}</b></span><meter :value="state[key]" min="0" max="100" :aria-label="label" /></label></div>
        <div class="care-actions"><button v-for="[key] in items" :key="key" type="button" :disabled="!!itemReason('use',key)" :title="itemReason('use',key)||undefined" :data-testid="`pet-use-${key}`" @click="emit('act',{type:'use',item:key})">{{ {food:'喂食',water:'喝水',toy:'玩耍'}[key] }} <small>余 {{ state.inventory[key] }}</small></button><button type="button" :disabled="busy||!settings.careEnabled" data-testid="pet-sleep" @click="emit('act',{type:state.sleeping?'wake':'sleep'})">{{ state.sleeping?'轻轻叫醒':'睡一会儿' }}</button></div>
        <p v-if="missingItems" class="care-hint">{{ missingItems }}用完了。<button type="button" @click="tab='bag'">去背包补充</button></p>
        <div class="daily" data-testid="pet-daily-goals">
          <b>今日小约定 <small>{{ 3-remainingGoals.length }} / 3</small></b>
          <p class="goal-list"><span v-for="goal in dailyGoals" :key="goal.label" :class="{done:goal.done}">{{ goal.done?'✓':'○' }} {{ goal.label }}</span></p>
          <p class="footnote">{{ state.daily.claimed?'今日奖励已入账，明天再一起继续。':remainingGoals.length?`还差${remainingGoals.join('、')}，完成后即可领奖。`:'三件小事都完成了，可以领取奖励。' }}</p>
          <button type="button" :disabled="busy||!settings.careEnabled||state.daily.claimed||!!remainingGoals.length" data-testid="pet-claim-daily" @click="emit('act',{type:'claim-daily'})">{{ state.daily.claimed?'今天的奖励已领取':'领取 30 星币 · 25 经验' }}</button>
        </div>
      </template>
      <template v-else-if="tab==='bag'">
        <article v-for="[key,item] in items" :key="key" class="item" :data-testid="`pet-item-${key}`">
          <i>{{ item.icon }}</i><div><b>{{ item.name }} <small>× {{ state.inventory[key] }}</small></b><small>{{ item.description }}</small></div>
          <div class="item-actions">
            <button type="button" :disabled="!!itemReason('buy',key)" :title="itemReason('buy',key)||undefined" :data-testid="`pet-buy-${key}`" @click="emit('act',{type:'buy',item:key})">{{ item.price }} 星币 · 买</button>
            <button type="button" :disabled="!!itemReason('use',key)" :title="itemReason('use',key)||undefined" :data-testid="`pet-bag-use-${key}`" @click="emit('act',{type:'use',item:key})">使用</button>
          </div>
          <div v-if="settings.careEnabled&&!busy" class="item-hints">
            <small v-if="itemReason('buy',key)">{{ itemReason('buy',key) }}</small>
            <small v-if="!state.sleeping&&itemReason('use',key)">{{ itemReason('use',key) }}</small>
          </div>
        </article>
        <p class="footnote">星币来自每日照料与完成专注，没有付费购买。</p>
      </template>
      <template v-else-if="tab==='growth'">
        <div class="growth"><span class="level-seal">{{ level }}</span><div><h3>{{ title }} · 写作伙伴</h3><p>{{ state.experience }} / {{ petNextLevel(state.experience) }} 经验</p><progress :value="state.experience-(level-1)**2*100" :max="petNextLevel(state.experience)-(level-1)**2*100" /></div></div>
        <p class="footnote">Lv.2 解锁「同行」称号；Lv.3 解锁「知己」称号与星光装饰。</p>
        <div class="badges"><article v-for="badge in badges" :key="badge.id" :class="{earned:badge.earned}" :data-testid="`pet-badge-${badge.id}`">
          <b>{{ badge.earned?'✦':'◇' }} {{ badge.label }}</b><small>{{ badge.requirement }}</small>
          <small>{{ badge.earned?'已达成':`${badge.value} / ${badge.target} ${badge.unit}` }}</small>
        </article></div>
        <p class="footnote">离线不扣状态，不会死亡或永久退级。</p>
      </template>
      <template v-else>
        <div class="focus-card"><small>为这一段故事留点时间</small><strong data-testid="pet-focus-clock" role="timer" aria-label="专注剩余时间" aria-live="off">{{ state.focus?focusClock.text.value:'开始专注' }}</strong><progress v-if="state.focus" :value="focusClock.progress.value" :max="state.focus.duration" aria-label="专注进度" /><p v-if="state.focus" data-testid="pet-focus-status">{{ focusStatus }}</p>
          <template v-if="!state.focus||state.focus.status==='complete'"><select v-model="minutes" aria-label="专注时长"><option v-for="value in [5,15,25,45,60]" :key="value" :value="value">{{ value }} 分钟</option></select><button type="button" :disabled="busy||!settings.careEnabled||state.sleeping" data-testid="pet-focus-start" @click="emit('act',{type:'focus-start',minutes})">开始</button></template>
          <template v-else><button type="button" :disabled="busy||!settings.careEnabled||(state.focus.status==='paused'&&state.sleeping)" :title="state.sleeping?'请先唤醒伙伴再继续':undefined" data-testid="pet-focus-toggle" @click="emit('act',{type:state.focus.status==='running'?'focus-pause':'focus-resume'})">{{ state.focus.status==='running'?'暂停':'继续' }}</button><button type="button" :disabled="busy" @click="emit('act',{type:'focus-cancel'})">取消</button><button v-if="state.sleeping&&settings.careEnabled" type="button" @click="tab='care'">去照料唤醒</button></template>
        </div>
        <label class="movement"><span>桌面活动</span><select :value="settings.followCursor?'follow':settings.roam?'roam':'off'" @change="update({followCursor:($event.target as HTMLSelectElement).value==='follow',roam:($event.target as HTMLSelectElement).value==='roam'})"><option value="off">原地陪伴</option><option value="roam">在工作区散步</option><option value="follow">轻轻跟随鼠标</option></select></label>
        <p class="footnote">操作、录音、睡眠和专注时暂停移动，关闭活动回到手动落点。</p>
        <div class="care-actions"><button type="button" @click="emit('dice')">离线骰子</button><button type="button" @click="emit('inspiration')">抽一张灵感签</button></div>
      </template>
    </template>
    <p v-else-if="!error">正在读取伙伴档案…</p>
    </div>
  </section>
</template>
<style scoped>
.care-panel{position:absolute;z-index:6;inset:8px 8px auto;height:calc(100% - 136px);display:flex;flex-direction:column;min-height:0;border:1px solid var(--color-line);border-radius:16px;background:var(--color-surface);box-shadow:0 8px 25px #203f2b1a;color:var(--color-ink);font:13px/1.65 var(--sans);overflow:hidden}
.care-error{flex:none;padding:10px 14px;border-bottom:1px solid var(--color-line)}.care-error p{margin:0 0 4px}
.care-hint{padding:8px 10px;margin:0 0 12px;border-radius:8px;background:var(--color-paper);font-size:12px;color:var(--color-muted)}.care-hint p{margin:0}.care-hint button{margin-top:4px;font-size:12px}.item-hints{grid-column:2}.goal-list{display:flex;gap:16px;color:var(--color-muted)}.goal-list .done{color:var(--color-jade)}.daily b small{font-weight:400;margin-left:8px;color:var(--color-muted);font-variant-numeric:tabular-nums}
.focus-card progress{display:block;width:100%;height:5px;margin:0 0 12px;accent-color:var(--color-jade)}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 6px;flex:none}h2{font-size:16px;margin:0;font-weight:600}em{font-style:normal;font-size:12px;border-radius:5px;padding:3px 6px;color:#52765f;background:#edf3e8;margin-left:5px}header button{border:0;background:transparent;font-size:20px;padding:0 5px;min-height:28px}
button,select{font:inherit;padding:6px 10px;min-height:34px;border:1px solid var(--color-line);border-radius:8px;background:var(--color-surface);color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid var(--color-jade);outline-offset:1px}button:hover:not(:disabled){background:#edf3ea;border-color:#b8ccbb}
nav{display:grid;grid-template-columns:.85fr 1.4fr .85fr .85fr;gap:2px;padding:4px 10px 8px;border-bottom:1px solid var(--color-line);flex:none}nav button{padding:5px 2px;border-color:transparent;font-size:12px;white-space:nowrap}nav button[aria-pressed=true]{background:#e8f0e3;color:#35684d;font-weight:600}
.care-scroll{overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;min-height:0;padding:10px 14px 14px;flex:1}.balance{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--color-muted);margin:0 0 12px}.balance span{min-width:0}.balance b{color:#8a713c;white-space:nowrap;font-weight:500}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px 15px}.stats label:last-child{grid-column:1/-1}.stats label span{display:flex;justify-content:space-between;font-size:13px}.stats b{font-weight:400;color:#708371;font-variant-numeric:tabular-nums}meter{display:block;width:100%;height:9px;accent-color:#6b9874}meter::-webkit-meter-optimum-value{background:#7da78c}meter::-webkit-meter-bar{border:0;background:#e8ece3}
.care-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-block:14px}.care-actions button{display:flex;justify-content:space-between;align-items:center;gap:6px;white-space:nowrap}.care-actions small{font-size:12px;color:var(--color-muted)}
.daily{border-top:1px solid var(--color-line);padding-top:12px;font-size:13px}.daily p{margin:8px 0}.daily button{width:100%;background:#edf3e8;font-size:12px}
.item{display:grid;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:6px 10px;border-bottom:1px solid var(--color-line);padding:10px 0}.item i{display:grid;place-items:center;font-style:normal;width:32px;height:38px;border-radius:9px;background:#edf1e5;font-size:16px}.item>div{min-width:0}.item b{font-size:13px;font-weight:600}.item small{display:block;font-size:12px;color:var(--color-muted)}.item b small{display:inline;margin-left:5px}.item-actions{grid-column:2;display:flex;gap:8px}.item-actions button{font-size:12px;padding:4px 9px;min-height:30px}
.footnote{font-size:12px;color:var(--color-muted);line-height:1.75;margin:10px 0}.growth{display:flex;gap:12px;align-items:center;padding:10px 0}.growth>div{min-width:0;flex:1}.level-seal{display:grid;place-items:center;width:44px;height:50px;border:1px solid #bed0b7;border-radius:10px;font-size:25px;color:#5d8064}.growth h3{font-size:14px;margin:0 0 4px}.growth p{font-size:12px;margin:0;color:var(--color-muted)}.growth progress{width:100%;height:6px;accent-color:#739b7c}.badges{display:grid;grid-template-columns:1fr 1fr;gap:8px}.badges article{padding:9px 8px;border:1px solid var(--color-line);border-radius:7px;background:var(--color-surface);color:var(--color-muted);font-size:12px}.badges b,.badges small{display:block}.badges b{font-weight:500;color:var(--color-ink)}.badges small{margin-top:3px;font-variant-numeric:tabular-nums}.badges .earned{background:#e8efdf;color:#567345}
.focus-card{text-align:center;padding:12px;background:#f0f4e9;border-radius:12px}.focus-card small{font-size:12px;color:var(--color-muted)}.focus-card strong{display:block;font:500 27px/1.8 var(--sans);font-variant-numeric:tabular-nums;color:#3c654b}.focus-card p{font-size:12px;margin:0 0 10px}.focus-card button{margin-left:6px}.movement{display:grid;gap:6px;font-size:13px;margin-top:14px}.movement select{width:100%;min-width:0}.care-error{color:#9b5348;font-size:13px}.care-error button{margin:4px 6px 0 0;font-size:12px}.notice{background:#f3eddc;padding:10px;border-radius:8px;font-size:13px}
</style>
