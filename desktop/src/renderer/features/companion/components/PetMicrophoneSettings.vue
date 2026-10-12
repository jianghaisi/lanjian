<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCompanionSettings } from '../composables/use-companion-settings'
import type { CompanionMicrophoneSettings } from '../../../../contracts/companion/companion-settings'
import type { CompanionInputDevice } from '../../../../contracts/companion/companion-asr'
const { settings, update } = useCompanionSettings()
const status = ref('正在检查本地识别…'), devices = ref<CompanionInputDevice[]>([])
function patch(value: Partial<CompanionMicrophoneSettings>) { void update({ microphone: { ...settings.value.microphone, ...value } }) }
async function refresh() {
  try { status.value = (await window.companionAsr?.status())?.installed ? 'SenseVoice 文件已安装 · 首次录音时加载' : '本地识别模型未安装，仍可打字交流' } catch { status.value = '识别状态读取失败，可重新检查' }
  try { devices.value = await window.companionAsr?.devices() ?? [] } catch { devices.value = [] }
}
onMounted(refresh)
</script>
<template>
  <section class="microphone-settings" aria-label="麦克风设置">
    <h3>麦克风输入</h3><p>主动录音后在本机识别。每段最多 30 秒，音频不保存，文字由你确认发送。</p>
    <label><span>允许语音输入</span><input type="checkbox" :checked="settings.microphone.enabled" @change="patch({enabled:($event.target as HTMLInputElement).checked})"></label>
    <label><span>录音方式</span><select :value="settings.microphone.mode" @change="patch({mode:($event.target as HTMLSelectElement).value as 'hold'|'toggle'})"><option value="toggle">点击开始 / 停止</option><option value="hold">按住说话</option></select></label>
    <label><span>输入设备</span><select :value="settings.microphone.deviceId" @change="patch({deviceId:($event.target as HTMLSelectElement).value})"><option value="">系统默认麦克风</option><option v-for="(device,index) in devices.filter(item => item.id && item.id !== 'default')" :key="device.id" :value="device.id">{{ device.label || `麦克风 ${index+1}` }}</option><option v-if="settings.microphone.deviceId && !devices.some(item => item.id === settings.microphone.deviceId)" :value="settings.microphone.deviceId">之前的设备暂不可用，请重新选择</option></select></label>
    <p>{{ status }}</p><button type="button" @click="refresh">重新检查设备和模型</button><small>设备名称可能在首次授权录音后显示；更改麦克风不会打开录音。</small>
  </section>
</template>
<style scoped>
.microphone-settings{margin-block:24px;font:14px/1.6 var(--sans);color:var(--color-ink,var(--ink))}h3{font-size:17px;margin-bottom:6px}p,small{font-size:12px;color:var(--color-muted,var(--muted))}small{display:block;margin-top:8px}label{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:46px;border-bottom:1px solid var(--color-line,var(--line))}select,button{max-width:65%;padding:7px 9px;border:1px solid var(--color-line,var(--line));border-radius:4px;background:var(--color-surface,var(--surface));color:inherit}input{accent-color:var(--color-jade,var(--jade))}
</style>
