<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import AppBootScreen from './AppBootScreen.vue'
import WorkspaceLoadingScreen from '../../features/library/components/WorkspaceLoadingScreen.vue'
import { useLoadingPreferences, type LoadingTheme } from '../composables/useLoadingPreferences'

const { preferences, error, update, reset } = useLoadingPreferences()
const notice = ref('')
const preview = ref<'boot' | 'work' | null>(null)
const previewDialog = ref<HTMLDialogElement | null>(null)
let opener: HTMLElement | null = null
function selectTheme(theme: LoadingTheme) {
  notice.value = update({ theme }) ? '已保存，下次启动与打开作品时使用这套动画。' : ''
}
async function openPreview(mode: 'boot' | 'work') {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  preview.value = mode
  await nextTick()
  previewDialog.value?.showModal()
  previewDialog.value?.querySelector<HTMLButtonElement>('[data-testid="app-boot-skip"], [data-testid="cancel-workspace-loading"]')?.focus({ preventScroll: true })
}
function closePreview() {
  previewDialog.value?.close()
  preview.value = null
  if (opener?.isConnected) opener.focus({ preventScroll: true })
  opener = null
}
function restore() { notice.value = reset() ? '原记录已备份，已恢复高冲击动画。' : '' }
onBeforeUnmount(() => previewDialog.value?.close())
</script>

<template>
  <section class="loader-preferences" data-testid="loader-preferences" aria-label="加载动画设置">
    <header><span>03 / TRANSITIONS</span><h3>加载动画</h3><p>两套原稿完整保留；同一套包含「项目启动」与「进入作品」。只改变外观，不增加等待时间。</p></header>
    <div class="loader-theme-options" role="group" aria-label="选择加载动画">
      <button v-for="theme in (['standard', 'impact'] as const)" :key="theme" type="button" :data-testid="`loader-theme-${theme}`" :aria-pressed="preferences.theme === theme" :class="['loader-theme', theme, { selected: preferences.theme === theme }]" @click="selectTheme(theme)">
        <span class="loader-swatch" aria-hidden="true"><i></i><b>{{ theme === 'standard' ? '岚笺' : '岚 / 笺' }}</b><small>{{ theme === 'standard' ? 'LOCAL ARCHIVE' : 'IGNITION SEQUENCE' }}</small><span class="swatch-meter"></span></span>
        <span class="theme-description"><strong>{{ theme === 'standard' ? '标准档案' : '高冲击' }}<span>{{ preferences.theme === theme ? '已选用' : '选择此套' }}</span></strong><small>{{ theme === 'standard' ? '轨道扫描 · 档案展开 · 克制入场' : '斜切入场 · 切角档案 · 粒子与印章' }}</small></span>
      </button>
    </div>
    <div class="loader-preview-actions"><button type="button" data-testid="loader-preview-boot" @click="openPreview('boot')">▶ 预览项目启动</button><button type="button" data-testid="loader-preview-work" @click="openPreview('work')">▶ 预览进入作品</button></div>
    <p class="loader-motion-note">预览不会重新打开作品、调用模型或改动正文。</p>
    <p v-if="notice && !error" class="loader-notice" role="status" data-testid="loader-preference-saved">{{ notice }}</p>
    <div v-if="error" class="loader-settings-error" role="alert"><p>{{ error }}</p><button type="button" data-testid="loader-preferences-reset" @click="restore">备份并恢复默认设置</button></div>
    <dialog v-if="preview" ref="previewDialog" class="loader-preview-dialog" data-testid="loader-preview-dialog" aria-label="加载动画预览" @cancel.prevent="closePreview" @close="preview = null">
      <AppBootScreen v-if="preview === 'boot'" phase="editor" :preview="true" :theme="preferences.theme" @skip="closePreview" />
      <WorkspaceLoadingScreen v-else title="你的作品档案" phase="chapter" :slow="false" :preview="true" :theme="preferences.theme" @cancel="closePreview" />
    </dialog>
  </section>
</template>

<style scoped>
.loader-preferences{color:var(--color-ink,#1d2220);font-family:var(--sans,sans-serif);margin-top:28px;padding-top:24px;border-top:1px solid var(--color-line,#d8d6cf)}.loader-preferences header>span{font:10px/1.5 monospace;letter-spacing:.15em;color:var(--color-muted,#626c65)}.loader-preferences h3{font:600 20px/1.4 var(--sans,sans-serif);margin:8px 0 12px}.loader-preferences header p{font:13px/1.8 var(--sans,sans-serif);margin:0 0 20px;color:var(--color-muted,#626c65)}.loader-theme-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.loader-theme{display:grid;padding:0;border:1px solid var(--color-line,#d8d6cf);background:var(--color-surface,#faf9f5);color:var(--color-ink,#1d2220);text-align:left;cursor:pointer;overflow:hidden;border-radius:2px}.loader-theme.selected{border:2px solid #96541f}.loader-theme:hover{border-color:#b36b2c}.loader-swatch{position:relative;display:grid;align-content:center;gap:10px;height:150px;overflow:hidden;padding:24px;background:#101715;color:#eeeae0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:24px 24px}.loader-swatch i{position:absolute;width:160px;height:160px;right:-12px;top:-20px;border:1px solid #a0baa345;border-radius:50%}.loader-swatch b{position:relative;font:500 32px/1.3 var(--serif,serif)}.loader-swatch small{font:8px/1.5 monospace;letter-spacing:.14em;color:#b3bfb6}.swatch-meter{height:3px;width:70%;background:linear-gradient(90deg,#ed6436 60%,#ffffff20 60%)}.impact .loader-swatch{background-color:#0b100f}.impact .loader-swatch i{border-radius:0;background:#ff6337;width:54px;height:220px;transform:rotate(18deg);top:-35px;right:30px}.impact .swatch-meter{background:repeating-linear-gradient(90deg,#ff6337 0 12px,transparent 12px 15px)}.theme-description{padding:16px;display:grid;gap:8px}.theme-description strong{display:flex;justify-content:space-between;align-items:center;gap:8px;font:600 14px/1.5 var(--sans,sans-serif)}.theme-description strong>span{font:500 10px/1.5 var(--sans,sans-serif);color:var(--color-muted,#626c65)}.selected .theme-description strong>span{color:#935018}.theme-description small{color:var(--color-muted,#626c65);font:12px/1.7 var(--sans,sans-serif)}.loader-preview-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:20px}.loader-preview-actions>button,.loader-settings-error button{min-height:40px;padding:8px 14px;border:1px solid var(--color-line,#a7aea6);color:var(--color-ink,#1d2220);background:var(--color-surface,#faf9f5);font:600 12px/1.5 var(--sans,sans-serif);cursor:pointer}.loader-preview-actions>button:hover{background:var(--color-paper,#eeeae0)}.loader-motion-note{font:12px/1.7 var(--sans,sans-serif);color:var(--color-muted,#626c65);margin:14px 0 0}.loader-notice{font-size:12px;line-height:1.7;color:var(--color-jade,#287a68)}.loader-settings-error{padding:12px 16px;margin-top:12px;border-left:3px solid #b4473e;background:var(--color-surface,#faf9f5);color:var(--color-danger,#b4473e);font:12px/1.7 var(--sans,sans-serif)}.loader-preferences button:focus-visible{outline:3px solid #bf7537;outline-offset:3px}.loader-preview-dialog{position:fixed;inset:0;margin:0;padding:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;background:#101715;overflow:auto}.loader-preview-dialog::backdrop{background:#101715}@media(max-width:650px){.loader-theme-options{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* The native top-layer preview is a window, never a second scroll container. */
.loader-preview-dialog { box-sizing: border-box; inline-size: 100dvw; block-size: 100dvh; min-inline-size: 0; min-block-size: 0; overflow: clip; }
</style>
