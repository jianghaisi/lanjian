<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DesktopPetCommand, DesktopPetPreferences, DesktopPetState } from '../../../../contracts/companion/desktop-pet'
import { desktopPetClient } from '../services/desktop-pet-client'
import { useCompanionSettings } from '../composables/use-companion-settings'
import { usePetAnimation } from '../composables/use-pet-animation'
import { petAnimations, type PetAnimation } from '../services/pet-action-motion'
import { petVideoAvailable } from '../services/pet-video-assets'
import DesktopPetArtwork from './DesktopPetArtwork.vue'
import PetMicrophoneSettings from './PetMicrophoneSettings.vue'
import DesktopCompanionNotice from './DesktopCompanionNotice.vue'
const browserHost = window.novelDesktop?.app.platform === 'browser'
defineProps<{ compact?: boolean }>()
const state = ref<DesktopPetState>(), busy = ref(false), error = ref('')
const tab = ref('appearance'), selectedAction = ref<PetAnimation>('eating')
const tabs = [{ id: 'appearance', label: '外观与位置' }, { id: 'actions', label: '动作与提醒' }, { id: 'care', label: '养成与活动' }, { id: 'microphone', label: '麦克风' }]
const animation = usePetAnimation(), preview = ref<HTMLElement>(), previewHidden = ref(true)
const availableAnimations = petAnimations.filter(item => petVideoAvailable(item.intent))
const previewLabel = computed(() => petAnimations.find(item => item.intent === animation.intent.value)?.label ?? '原地陪伴')
const careMessage = ref(''), recoveringCare = ref(false)
async function recoverCare() {
  if (recoveringCare.value) return
  recoveringCare.value = true
  try { if (!window.companionCare) throw new Error('CARE_UNAVAILABLE'); await window.companionCare.recover(); careMessage.value = '原养成档案已备份，新档案已保存。' }
  catch { careMessage.value = '原档案未能完成备份，恢复已取消。' }
  finally { recoveringCare.value = false }
}
const { settings, error: preferenceError, update, recover, retry } = useCompanionSettings()
let stop: (() => void) | undefined, epoch = 0, disposed = false, observer: IntersectionObserver | undefined, inView = false
function visibility() { previewHidden.value = document.hidden || !inView; if (previewHidden.value) animation.cancel() }
async function command(value: DesktopPetCommand) {
  if (busy.value) return
  busy.value = true; error.value = ''
  const token = epoch
  try { const next = await desktopPetClient.command(value); if (!disposed && epoch === token) state.value = next } catch { error.value = '桌宠设置未能保存，请重试。' } finally { if (!disposed) busy.value = false }
}
function configure(patch: Partial<DesktopPetPreferences>) { if (state.value) void command({ type: 'configure', preferences: { ...state.value.preferences, ...patch } }) }
async function load() {
  const token = epoch; error.value = ''
  try { const value = await desktopPetClient.get(); if (!disposed && token === epoch) state.value = value } catch { error.value = '桌宠状态未能读取，请重试。' }
}
onMounted(() => {
  if (browserHost) return
  if (!desktopPetClient.available()) { error.value = '桌宠需要在桌面应用中使用。'; return }
  stop = desktopPetClient.onState(value => { epoch++; state.value = value })
  void load()
  observer = new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); visibility() })
  if (preview.value) observer.observe(preview.value)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => { disposed = true; stop?.(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility) })
</script>
<template>
  <DesktopCompanionNotice v-if="browserHost" />
  <section v-else class="pet-settings" :class="{ compact }" aria-label="桌宠设置" data-testid="desktop-pet-settings">
    <header class="pet-heading"><div v-if="!compact"><small>故事之外的陪伴</small><h3>桌面伙伴</h3><p>由你决定是否开启。选择会保存在本机，回到书库时暂时收起。</p></div>
      <label v-if="state" class="enable-control"><span>{{ (state.enabled ?? state.open) ? '已启用' : '未启用' }}</span><input type="checkbox" aria-label="启用桌宠" :disabled="busy" :checked="state.enabled ?? state.open" @change="command({type:'enable', enabled:($event.target as HTMLInputElement).checked})"></label>
    </header>
    <nav class="pet-tabs" aria-label="桌宠设置分类"><button v-for="item in tabs" :key="item.id" type="button" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}</button></nav>
    <div class="pet-settings-layout">
      <div class="pet-fields">
        <template v-if="state">
          <section v-if="tab === 'appearance'" aria-label="外观与位置">
            <h4>放在舒服的位置</h4>
            <label class="setting-row"><span>角色大小<small>只改变角色，菜单和文字保持可读</small></span><select :value="state.preferences.scale" :disabled="busy" data-testid="pet-scale" @change="configure({ scale: Number(($event.target as HTMLSelectElement).value) })"><option v-for="scale in [0.6,0.75,1,1.25,1.5,1.8]" :key="scale" :value="scale">{{ Math.round(scale*100) }}%</option></select></label>
            <label class="setting-row"><span>锁定位置<small>暂停拖动、散步和跟随，仍可点击互动</small></span><input type="checkbox" :disabled="busy" :checked="state.preferences.positionLocked" data-testid="pet-position-lock" @change="configure({positionLocked:($event.target as HTMLInputElement).checked})"></label>
            <label class="setting-row"><span>始终置顶</span><input type="checkbox" :disabled="busy" :checked="state.preferences.alwaysOnTop" @change="configure({alwaysOnTop:($event.target as HTMLInputElement).checked})"></label>
            <label class="setting-row"><span>鼠标穿透<small>让点击落到后方窗口；可用下方按钮恢复</small></span><input type="checkbox" :disabled="busy" :checked="state.preferences.clickThrough" data-testid="pet-click-through" @change="configure({clickThrough:($event.target as HTMLInputElement).checked})"></label>
            <div class="pet-settings-actions"><button type="button" :disabled="busy" @click="command({type:'locate'})">找回并恢复点击</button><button type="button" :disabled="busy || !(state.enabled ?? state.open)" @click="command({type:'hide'})">关闭桌宠</button></div>
            <p class="field-note">开启后在作品中出现。关闭会记住你的选择，下次进入作品也不会自动加载。</p>
          </section>
          <section v-else-if="tab === 'actions'" aria-label="动作与提醒">
            <h4>按你的节奏陪伴</h4>
            <p class="field-note">点击角色摸头，右键打开照料与聊天。<template v-if="!compact">右侧可预览每个动作。</template></p>
            <label class="setting-row"><span>减少动画<small>保留动作姿态，关闭摆动和自动移动</small></span><input type="checkbox" :checked="settings.reducedMotion" @change="update({reducedMotion:($event.target as HTMLInputElement).checked})"></label>
            <label class="setting-row"><span>休息提醒<small>需同时允许主动发言；忙碌时延后</small></span><select :value="state.preferences.reminderMinutes" :disabled="busy" @change="configure({reminderMinutes:Number(($event.target as HTMLSelectElement).value)})"><option v-for="minutes in [0,25,45,60]" :key="minutes" :value="minutes">{{ minutes ? `${minutes} 分钟` : '关闭' }}</option></select></label>
          </section>
          <section v-else-if="tab === 'care'" aria-label="养成与活动设置">
            <h4>一位跨作品的伙伴</h4><p class="field-note">离线不扣状态，关闭养成会保留档案。</p>
            <label class="setting-row"><span>开启轻养成</span><input type="checkbox" :checked="settings.careEnabled" @change="update({careEnabled:($event.target as HTMLInputElement).checked})"></label>
            <label class="setting-row"><span>自动活动<small>{{ state.preferences.positionLocked ? '位置已锁定，解锁后按此设置活动' : '互动、录音、专注和睡眠期间暂停' }}</small></span><select :value="settings.followCursor?'follow':settings.roam?'roam':'off'" @change="update({followCursor:($event.target as HTMLSelectElement).value==='follow',roam:($event.target as HTMLSelectElement).value==='roam'})"><option value="off">原地陪伴</option><option value="roam">工作区散步</option><option value="follow">跟随鼠标</option></select></label>
            <details><summary>养成档案恢复</summary><p class="field-note">将当前档案备份后创建新档案。已有星币、物品与成长只保留在备份中。</p><button type="button" :disabled="recoveringCare" @click="recoverCare">备份现有档案并重新养成</button><p v-if="careMessage" role="status">{{ careMessage }}</p></details>
          </section>
          <PetMicrophoneSettings v-else />
        </template>
        <p v-else-if="!error">正在读取桌宠设置…</p>
        <div v-if="error || state?.error || preferenceError" class="setting-error" role="alert"><p>{{ error || state?.error || preferenceError }}</p><button v-if="error" type="button" :disabled="busy" @click="load">重新读取</button><button v-if="state?.error" type="button" :disabled="busy" @click="command({type:'recover-settings'})">备份原记录并恢复桌宠窗口设置</button><template v-if="preferenceError"><button type="button" @click="retry">重试</button><button type="button" @click="recover">备份原记录并恢复伙伴设置</button></template></div>
      </div>
      <aside v-if="!compact" ref="preview" class="pet-preview" aria-label="动作预览" data-testid="pet-action-preview">
        <div class="preview-title"><span>动作预览</span><small>不消耗物品</small></div>
        <div class="preview-art"><DesktopPetArtwork state="idle" :intent="animation.intent.value" :action="animation.sequence.value" :paused="settings.reducedMotion || Boolean(state?.context.reducedMotion)" :hidden="previewHidden" :tilt="0" :settling="false" :speaking="false" :auto-blink="true" @started="animation.started" /></div>
        <p class="preview-status" role="status">{{ previewLabel }}</p>
        <p class="preview-note">{{ availableAnimations.length }} 种可用动作 · 预览不播放声音</p>
        <div class="preview-actions"><button v-for="item in availableAnimations" :key="item.intent" type="button" :aria-pressed="selectedAction === item.intent" :data-testid="`pet-preview-${item.intent}`" @click="selectedAction = item.intent; animation.play(item.intent)">{{ item.label }}</button></div>
        <button class="replay" type="button" @click="animation.play(selectedAction)">↻ 重播动作</button>
      </aside>
    </div>
  </section>
</template>
<style scoped>
/* The desktop shell's 1000px body floor otherwise clips this settings page at
   large page zoom before its own responsive layout gets a chance to shrink. */
:global(body:has([data-testid="desktop-pet-settings"])){min-width:0}
:global(.settings-editor:has([data-testid="desktop-pet-settings"]) > .settings-category-navigation){min-width:0;max-width:100%;grid-template-columns:repeat(5,minmax(92px,1fr))}
.pet-settings{container-type:inline-size;font:14px/1.6 var(--sans);color:var(--color-ink);margin-bottom:28px;min-width:0}
.pet-settings.compact{margin:0;font-size:13px}.compact .pet-heading{justify-content:flex-end;padding-bottom:10px}.compact .pet-settings-layout{grid-template-columns:minmax(0,1fr)}.compact .pet-tabs{margin-bottom:14px}.compact .pet-tabs button{font-size:12px;padding:7px 5px}.compact .setting-row{gap:10px}.compact .setting-row select{max-width:48%}
.pet-heading{display:flex;justify-content:space-between;gap:24px;align-items:center;padding-bottom:20px}.pet-heading h3{font:24px/1.4 var(--serif);margin:3px 0 8px}.pet-heading p{margin:0;color:var(--color-muted);font-size:13px}.pet-heading small{color:var(--color-jade);font-size:12px;letter-spacing:.12em}
.enable-control{display:flex;align-items:center;gap:12px;flex:none}.pet-settings input[type=checkbox]{width:19px;height:19px;flex:none;accent-color:var(--color-jade);cursor:pointer;margin:0}
.pet-tabs{display:flex;gap:4px;border-bottom:1px solid var(--color-line);margin-bottom:22px;flex-wrap:wrap}.pet-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:9px 13px;color:var(--color-muted)}.pet-tabs button[aria-pressed=true]{color:var(--color-jade);border-bottom-color:var(--color-jade);font-weight:600}
.pet-settings-layout{display:grid;grid-template-columns:minmax(0,1fr) 244px;gap:32px;align-items:start}.pet-fields{min-width:0}.pet-fields h4{font-size:15px;font-weight:600;margin:0 0 10px}.setting-row{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:62px;padding:10px 0;border-bottom:1px solid var(--color-line)}.setting-row>span{display:grid;gap:3px;min-width:0}.setting-row small,.field-note{font-size:12px;line-height:1.7;color:var(--color-muted)}.setting-row select{width:154px;min-width:0;max-width:45%;flex:none}.field-note{margin:14px 0}.pet-settings select,.pet-settings button{font:inherit;border:1px solid var(--color-line);background:var(--color-surface);color:inherit;border-radius:5px;padding:8px 11px;min-height:36px}.pet-settings button{cursor:pointer}.pet-settings button:disabled{opacity:.5;cursor:default}.pet-settings button:focus-visible,.pet-settings input:focus-visible,.pet-settings select:focus-visible{outline:2px solid var(--color-jade);outline-offset:3px}.pet-settings button:hover:not(:disabled){border-color:var(--color-jade)}
.pet-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}.setting-error{color:var(--color-danger,#a34539);font-size:13px}.setting-error button{margin:4px}.pet-fields details{margin-top:22px;font-size:12px}.pet-fields summary{cursor:pointer;color:var(--color-muted)}
.pet-preview{background:var(--color-paper);border:1px solid var(--color-line);padding:16px;min-width:0}.preview-title{display:flex;justify-content:space-between;align-items:center;font-size:13px}.preview-title small{font-size:11px;color:var(--color-muted)}.preview-art{height:218px;margin:10px auto 0;max-width:218px}.preview-status{text-align:center;font-size:12px;color:var(--color-muted);margin:5px 0 15px;min-height:20px}.preview-note{font-size:11px;color:var(--color-muted);text-align:center;margin:0 0 8px}.preview-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:252px;overflow:auto;padding:3px}.preview-actions button{font-size:12px;padding:6px}.preview-actions button[aria-pressed=true]{color:var(--color-jade);border-color:var(--color-jade)}.pet-preview .replay{display:block;width:100%;border:0;background:none;font-size:12px;margin-top:5px;color:var(--color-muted)}
.pet-fields :deep(.microphone-settings){margin:0}.pet-fields :deep(.microphone-settings h3){margin-top:0;font-size:15px}.pet-fields :deep(.microphone-settings label){gap:16px;padding:9px 0;min-height:58px}.pet-fields :deep(.microphone-settings select){min-width:0;max-width:60%;font:inherit}.pet-fields :deep(.microphone-settings input[type=checkbox]){width:19px;height:19px;flex:none}
@container(max-width:700px){.pet-settings-layout{grid-template-columns:minmax(0,1fr);gap:20px}.pet-preview{max-width:340px;width:100%;justify-self:center}.pet-heading{align-items:flex-start;gap:14px}.pet-heading h3{font-size:21px}.enable-control{font-size:12px}.pet-tabs button{padding:8px;font-size:12px}}
</style>
