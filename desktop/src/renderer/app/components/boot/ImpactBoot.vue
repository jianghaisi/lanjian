<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BrandLogo from '../../../ui/BrandLogo.vue'
import { BOOT_COMPLETION_DURATION_MS, useBootCompletion } from '../../composables/use-boot-completion'

defineOptions({ inheritAttrs: false })
type BootPhase = 'projects' | 'editor' | 'session' | 'models' | 'ready'
const props = withDefaults(defineProps<{ palette?: 'system' | 'light' | 'dark'; phase: BootPhase; error?: string; detail?: string; modelsRequired?: boolean; canSkipModels?: boolean; preview?: boolean; theme?: 'standard' | 'impact'; reducedMotion?: boolean }>(), { palette: 'system', error: '', detail: '', modelsRequired: false, canSkipModels: false, preview: false, theme: 'impact', reducedMotion: false })
const emit = defineEmits<{ skip: []; retry: []; visualReady: []; complete: []; skipModels: [] }>()
const bootRoot = ref<HTMLElement | null>(null)
const actionButton = ref<HTMLButtonElement | null>(null)
const progressLine = ref<HTMLElement | null>(null)
const lineMovingForward = ref(true)
const nativeWindowGate = typeof window !== 'undefined'
  && typeof window.novelDesktop?.app?.onWindowShown === 'function'
const motionReady = ref(typeof document === 'undefined'
  || (!nativeWindowGate && document.visibilityState === 'visible'))
let stopWindowShown: (() => void) | undefined
const LINE_START_PERCENT = 5
const LINE_PATROL_DURATION_MS = 1350
const readyToEnter = computed(() => props.phase === 'ready' && !props.error && !props.preview)
const documentVisible = ref(typeof document === 'undefined' || document.visibilityState === 'visible')
function updateDocumentVisible(){ documentVisible.value = document.visibilityState === 'visible' }
const readyToAnimate = computed(() => readyToEnter.value && motionReady.value && documentVisible.value)
useBootCompletion(readyToAnimate, () => emit('complete'))
const steps = computed<Array<{ id: BootPhase; label: string; detail: string }>>(() => [
  { id: 'projects', label: '读取本地作品库', detail: '获取这台电脑上的作品索引' },
  { id: 'editor', label: '准备界面与字体', detail: '等待本地界面完成初次渲染' },
  { id: 'session', label: '准备作品库', detail: '应用本机偏好，准备作品入口' },
  ...(props.modelsRequired || props.phase === 'models' ? [{ id: 'models' as const, label: '准备看板娘模型', detail: '等待所选模型实际就绪' }] : []),
  { id: 'ready', label: '进入作品库', detail: '进入你的叙事终端' },
])
const activeIndex = computed(() => Math.max(0, steps.value.findIndex(step => step.id === props.phase)))
const current = computed(() => steps.value[activeIndex.value]!)
const completed = (index: number) => index < activeIndex.value || (!props.error && props.phase === 'ready')
const progressPercent = computed(() => Math.round(((activeIndex.value + 1) / steps.value.length) * 100))

function moveProgressLine() {
  const line = progressLine.value
  if (!line || props.error || !motionReady.value) return
  // Preserve the currently painted position when a phase expands the range.
  // Freeze it as pixels before changing the percentage target so the browser
  // cannot re-interpolate an in-flight percentage against the expanded range.
  const parentLeft = line.parentElement?.getBoundingClientRect().left ?? 0
  const currentLeft = line.getBoundingClientRect().left - parentLeft
  line.style.transitionDuration = '0ms'
  line.style.left = `${currentLeft}px`
  line.getBoundingClientRect()
  line.style.transitionDuration = `${props.phase === 'ready' ? BOOT_COMPLETION_DURATION_MS : LINE_PATROL_DURATION_MS}ms`
  line.style.left = props.phase === 'ready'
    ? 'calc(100% - 2px)'
    : `${lineMovingForward.value ? progressPercent.value : LINE_START_PERCENT}%`
  line.style.opacity = '1'
}

function continueProgressPatrol(event: TransitionEvent) {
  if (event.propertyName !== 'left' || props.error || props.phase === 'ready') return
  lineMovingForward.value = !lineMovingForward.value
  moveProgressLine()
}

function revealBootMotion() {
  if (motionReady.value) return
  motionReady.value = true
  void nextTick(() => emit('visualReady'))
}

function revealBrowserBootMotion() {
  if (document.visibilityState === 'visible') revealBootMotion()
}

onMounted(() => {
  document.addEventListener('visibilitychange', updateDocumentVisible)
  ;(actionButton.value || bootRoot.value)?.focus({ preventScroll: true })
  if (motionReady.value) void nextTick(() => { moveProgressLine(); emit('visualReady') })
  else if (nativeWindowGate) stopWindowShown = window.novelDesktop?.app.onWindowShown(revealBootMotion)
  else document.addEventListener('visibilitychange', revealBrowserBootMotion)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', updateDocumentVisible)
  stopWindowShown?.()
  document.removeEventListener('visibilitychange', revealBrowserBootMotion)
})
watch([progressPercent, () => props.error, motionReady], moveProgressLine, { flush: 'post' })
</script>

<template>
  <section ref="bootRoot" class="app-boot" role="dialog" aria-modal="true" aria-labelledby="app-boot-title" tabindex="-1" data-testid="app-boot" data-boot-style="impact" :data-palette="palette" :data-boot-phase="phase" :data-loader-progress="progressPercent" :data-loader-theme="theme" :class="[theme, { 'has-error': !!error, 'is-ready': phase === 'ready', 'reduce-motion': reducedMotion, 'motion-ready': motionReady }]" @keydown.esc.stop.prevent="preview && $emit('skip')">
    <div class="terminal-grid" aria-hidden="true"></div><div class="terminal-orbit" aria-hidden="true"><i></i></div><div class="terminal-ghost" aria-hidden="true">{{ theme === 'impact' ? '00' : 'LJ' }}</div><div ref="progressLine" class="terminal-scan" data-testid="boot-progress-line" aria-hidden="true" @transitionend="continueProgressPatrol"></div>
    <div v-if="theme === 'impact'" class="impact-slash" aria-hidden="true"></div>
    <div v-if="theme === 'impact'" class="impact-particles" aria-hidden="true"><i v-for="n in 18" :key="n" :style="{ left: `${(n * 37) % 94 + 3}%`, top: `${(n * 53) % 82 + 9}%`, animationDelay: `${(n % 7) * .08}s` }"></i></div>
    <header class="boot-header"><BrandLogo /><span>叙事档案终端 / SYSTEM INITIALIZATION</span><span v-if="preview" class="boot-demo" data-testid="app-boot-preview">动画预览 · 非真实载入</span></header>
    <main class="boot-body">
      <div class="terminal-brand" aria-hidden="true">
        <p><i></i>{{ theme === 'impact' ? 'NOVEL CREATION TERMINAL' : 'WRITING OPERATING SYSTEM' }}</p>
        <div class="terminal-wordmark"><span>岚</span><b>笺</b></div>
        <small>LANJIAN / NOVEL STUDIO</small>
        <p class="terminal-motto">记录人类的想象，也守护未完成的世界。</p>
      </div>
      <div class="boot-console">
        <p class="boot-eyebrow"><i aria-hidden="true"></i>{{ error ? '启动需要处理' : preview ? '启动界面预览' : phase === 'ready' ? 'SYSTEM READY / 准备完成' : '正在准备本地工作环境' }}</p>
        <h1 id="app-boot-title">岚笺<span>让故事，有迹可循。</span></h1>
        <p class="boot-current" role="status" aria-live="polite" aria-atomic="true"><b>{{ error ? '暂时无法完成初始化' : current.label }}</b><span>{{ error ? '请重新尝试；原作品文件不会因此改动。' : phase === 'models' ? '正在接入已启用的本地模型' : detail || current.detail }}</span></p>
        <div class="terminal-meter"><span>{{ theme === 'impact' ? 'IGNITION SEQUENCE / 系统点火' : 'SYSTEM BOOT / 系统启动' }}</span><strong>{{ activeIndex + 1 }}<small> / {{ steps.length }}</small></strong></div>
        <div class="terminal-progress" :style="{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }" aria-hidden="true"><i v-for="(_, index) in steps" :key="index" :class="{ complete: completed(index), active: index === activeIndex }"></i></div>
        <ol class="boot-steps" aria-label="软件启动阶段">
          <li v-for="(step, index) in steps" :key="step.id" :class="{ complete: completed(index), active: index === activeIndex }" :aria-current="index === activeIndex ? 'step' : undefined">
            <span class="step-code" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ step.label }}</span><b>{{ step.id === 'models' && canSkipModels ? error ? '待处理' : '进行中' : completed(index) ? '已就绪' : index === activeIndex ? error ? '待处理' : '进行中' : '等待' }}</b>
          </li>
        </ol>
        <p v-if="error" class="boot-error" role="alert">{{ error }}</p>
        <p v-if="preview" class="boot-note">仅重播视觉界面，不重新初始化或修改作品。</p>
      </div>
    </main>
    <footer class="boot-footer"><span>本地创作 · 从容开始</span><span class="boot-footer-code">LANJIAN / AUTHOR WORKSPACE</span><div v-if="error || preview || canSkipModels" class="boot-actions"><button v-if="error" ref="actionButton" type="button" class="primary" data-testid="app-boot-retry" @click="$emit('retry')">重新尝试</button><button v-if="preview" ref="actionButton" type="button" data-testid="app-boot-skip" @click="$emit('skip')">关闭预览 <span aria-hidden="true">→</span></button><button v-else-if="canSkipModels" type="button" data-testid="app-boot-skip-models" @click="$emit('skipModels')">继续进入 <span aria-hidden="true">→</span></button></div></footer>
  </section>
</template>

<style scoped>
.app-boot { position: fixed; inset: 0; z-index: 5100; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; color: #f3f0e8; background: #1d2220; font-family: var(--sans, "Microsoft YaHei UI", sans-serif); }.app-boot:focus{outline:none}
.boot-header { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; min-height: 72px; padding: 16px 40px; border-bottom: 1px solid #ffffff1a; }.boot-header > span:not(.brand-logo) { color: #a5ada6; font-size: 10px; letter-spacing: .14em; }.boot-header :deep(.brand-wordmark) { color: #f3f0e8; }.boot-header :deep(.brand-seal) { color: #1d2220; background: var(--color-orange, #e99a35); }.boot-header .boot-demo { margin-left: auto; padding: 6px 8px; border: 1px solid #b98a48; color: #e8b96f !important; }
.boot-body { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(360px, 1fr); gap: clamp(32px, 7vw, 112px); align-items: center; min-height: 0; padding: 40px clamp(32px, 7vw, 112px); overflow: auto; }
.boot-stage { position: relative; display: flex; flex-direction: column; align-self: stretch; justify-content: center; min-width: 0; min-height: 360px; background-image: linear-gradient(#f3f0e808 1px, transparent 1px), linear-gradient(90deg, #f3f0e808 1px, transparent 1px); background-size: 40px 40px; }
.stage-coordinates { position: absolute; top: 16px; left: 16px; z-index: 1; font: 10px/1.8 monospace; color: #8c978f; letter-spacing: .12em; }
.stage-frame { position: relative; display: flex; justify-content: center; align-items: flex-end; height: 100%; min-height: 340px; max-height: 500px; overflow: hidden; border: 1px solid #ffffff1f; border-top: 0; border-bottom-color: #e99a3570; }
.stage-frame::before { content: ''; position: absolute; inset: 17% 8%; border: 1px solid #a9b9ab26; transform: rotate(-8deg); }.stage-frame::after { content: 'LJ'; position: absolute; right: 8px; bottom: 0; color: #f3f0e807; font: 700 clamp(90px, 12vw, 180px)/.8 monospace; }
.stage-frame :deep(svg) { position: relative; z-index: 1; height: 94%; max-height: 470px; max-width: 90%; filter: brightness(.3) sepia(.12); opacity: .9; }
.scan-line { position: absolute; inset: 0 0 auto; z-index: 2; height: 1px; background: linear-gradient(90deg, transparent, #e99a35b3, transparent); animation: boot-scan 3.6s ease-in-out infinite; pointer-events: none; }
.stage-caption { display: flex; gap: 16px; align-items: center; padding: 16px 0; color: #a5ada6; font-size: 11px; letter-spacing: .08em; }.stage-caption i { font-style: normal; color: #e99a35; }
.boot-console { min-width: 0; max-width: 560px; }.boot-eyebrow { display: flex; align-items: center; gap: 12px; margin: 0 0 24px; color: #b9c4bb; font-size: 12px; letter-spacing: .12em; }.boot-eyebrow i { width: 6px; height: 6px; background: var(--color-orange, #e99a35); }
.boot-console h1 { display: grid; gap: 16px; margin: 0; font: 500 clamp(44px, 6vw, 76px)/1.1 var(--serif, serif); letter-spacing: .12em; }.boot-console h1 > span { font: 400 16px/1.7 var(--sans, sans-serif); letter-spacing: .08em; color: #c0c6bf; }
.boot-current { display: grid; gap: 8px; margin: 32px 0 24px; padding-left: 16px; border-left: 2px solid var(--color-orange, #e99a35); }.boot-current b { font-size: 14px; font-weight: 500; }.boot-current > span { font-size: 12px; line-height: 1.6; color: #a5ada6; }
.boot-steps { list-style: none; margin: 0; padding: 0; border-top: 1px solid #ffffff20; }.boot-steps li { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 48px; border-bottom: 1px solid #ffffff12; color: #8a938b; font-size: 12px; }.boot-steps li > b { font-size: 10px; font-weight: 400; }.step-code { font: 10px/1 monospace; }.boot-steps li.complete { color: #adbcad; }.boot-steps li.active { color: #f3f0e8; }.active > b { color: #e8b96f; }
.boot-error { padding: 12px; border-left: 3px solid #cf776b; background: #b4473e17; color: #e7bcb5; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.boot-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }.boot-actions button { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 40px; padding: 10px 16px; color: #e6e8df; background: transparent; border: 1px solid #747d73; border-radius: 2px; font: 500 12px/1.5 var(--sans, sans-serif); cursor: pointer; }.boot-actions button.primary { background: #e99a35; color: #1d2220; border-color: #e99a35; }.boot-actions button:hover { border-color: #e99a35; background: #e99a3520; }.boot-actions button.primary:hover { background: #f0b566; }.boot-actions button:focus-visible { outline: 3px solid #e99a35; outline-offset: 3px; }
.boot-note { margin: 16px 0 0; font-size: 11px; line-height: 1.7; color: #a5ada6; }.boot-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 16px; padding: 12px 40px; border-top: 1px solid #ffffff1a; color: #a5ada6; font-size: 10px; letter-spacing: .1em; }.boot-footer .boot-actions { margin-top: 0; margin-left: auto; }
.has-error .scan-line, .is-ready .scan-line { animation: none; opacity: 0; }
@keyframes boot-scan { 0% { top: 5%; opacity: 0; } 20%, 70% { opacity: 1; } 100% { top: 95%; opacity: 0; } }
@media (max-width: 850px) { .boot-body { grid-template-columns: minmax(200px, .8fr) minmax(300px, 1.2fr); padding: 24px; gap: 32px; }.boot-header { padding: 16px 24px; }.boot-header > span:not(.brand-logo):not(.boot-demo) { display: none; }.boot-stage { min-height: 320px; }.stage-coordinates { font-size: 8px; }.stage-caption { font-size: 10px; gap: 8px; }.boot-footer-code { display: none; } }
@media (max-width: 650px) { .boot-body { display: block; padding: 24px; }.boot-stage { display: none; }.boot-console { max-width: none; }.boot-header { gap: 12px; }.boot-footer { padding-inline: 24px; }.boot-footer span:last-child { display: none; }.boot-current { margin-block: 24px; } }
@media (max-height: 640px) { .boot-body { align-items: start; }.boot-console h1 { font-size: 44px; gap: 8px; }.boot-eyebrow { margin-bottom: 16px; }.boot-current { margin-block: 20px; }.boot-steps li { min-height: 40px; }.boot-actions { margin-top: 16px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; }.scan-line { display: none; } }
/* Approved loaders.html / loaders-impact.html: visuals only, phases remain lifecycle-driven. */
.app-boot{--loader-orange:#ed6436;--loader-ease:cubic-bezier(.22,.8,.25,1);background:#101715}
.boot-header :deep(.brand-archive-mark),.boot-header :deep(.brand-latin){color:#f3f0e8}
.terminal-grid,.terminal-orbit,.terminal-ghost,.terminal-scan{position:absolute;pointer-events:none}
.terminal-grid{inset:0;background-image:linear-gradient(var(--loader-grid) 1px,transparent 1px),linear-gradient(90deg,var(--loader-grid) 1px,transparent 1px);background-size:58px 58px;transform:perspective(800px) rotateX(56deg) scale(1.55) translateY(15%);transform-origin:50% 100%}
.terminal-orbit{width:min(55vw,720px);aspect-ratio:1;left:55%;top:45%;transform:translate(-50%,-50%);border:1px solid var(--loader-orbit);border-radius:50%}.terminal-orbit:before,.terminal-orbit:after{content:'';position:absolute;inset:13%;border:1px dashed var(--loader-orbit-strong);border-top-color:color-mix(in srgb,var(--loader-orange) 68%,var(--loader-ink));border-radius:50%;animation:terminal-orbit-slow 12s linear infinite}.terminal-orbit:after{inset:35%;border-style:solid;border-right-color:var(--loader-orange);animation:terminal-orbit-fast 7s linear infinite reverse}.terminal-orbit i{position:absolute;inset:-8px;border-radius:50%;border-top:2px solid var(--loader-orange);animation:terminal-orbit 3.2s var(--loader-ease) both}
.terminal-scan{top:0;bottom:0;left:5%;width:2px;opacity:.28;background:linear-gradient(180deg,transparent 4%,var(--loader-orange) 24% 76%,transparent 96%);box-shadow:0 0 14px color-mix(in srgb,var(--loader-orange) 48%,transparent);transition-property:left,opacity;transition-timing-function:linear}.terminal-ghost{right:-2vw;bottom:-7vh;color:#ffffff06;font:900 min(39vw,560px)/.72 monospace;letter-spacing:-.09em}
.boot-header,.boot-body,.boot-footer{position:relative;z-index:10}.boot-header{border:0}.boot-body{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:clamp(24px,7vh,80px);padding:32px clamp(32px,10vw,160px)}
.terminal-brand>p:first-child{display:flex;align-items:center;gap:13px;color:#b3b9b0;font:600 10px/1.5 monospace;letter-spacing:.15em;margin:0 0 22px}.terminal-brand i{width:44px;height:2px;background:var(--loader-orange)}.terminal-wordmark{display:flex;align-items:center;font:500 clamp(66px,8.8vw,132px)/1 var(--serif,serif);letter-spacing:-.04em}.terminal-wordmark b{font-weight:500;color:var(--loader-orange)}.terminal-wordmark span,.terminal-wordmark b{animation:terminal-brand-in .75s .1s var(--loader-ease) both}.terminal-brand>small{display:block;margin:22px 0 0;color:#b3b9b0;font:600 11px/1.5 monospace;letter-spacing:.42em}.terminal-motto{font-size:12px;letter-spacing:.1em;color:#b3b9b0;margin:20px 0 0}
.boot-console{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,.68fr);column-gap:64px;max-width:none}.boot-console h1,.boot-eyebrow{position:absolute;clip-path:inset(50%);height:1px;width:1px;overflow:hidden}.boot-current{grid-column:1;margin:0 0 24px;border:0;padding:0}.terminal-meter{grid-column:1;display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:12px;font:600 9px/1.5 monospace;letter-spacing:.12em;color:#b4bcb6}.terminal-meter strong{font-size:28px;line-height:1;color:#f2efe6}.terminal-meter small{font-size:12px;font-weight:400;color:#b4bcb6}.terminal-progress{grid-column:1;display:grid;grid-template-columns:repeat(4,1fr);gap:3px;height:5px}.terminal-progress i{background:#ffffff1a}.terminal-progress i.complete{background:var(--loader-orange)}.terminal-progress i.active{background:#eda448;animation:terminal-signal 1.6s ease-in-out infinite}.boot-steps{grid-column:2;grid-row:1/4;align-self:end;border:0}.boot-steps li{min-height:34px;border-top:1px solid #ffffff17;border-bottom:0;color:#a1aaa2}.boot-steps li.complete{color:#a6cdbf}.boot-steps li.active{color:#f2efe6}.boot-note,.boot-error{grid-column:1/-1}.boot-footer{background:#101715bd}
.impact{background:var(--loader-canvas)}.impact .terminal-grid{transform:none;background-size:64px 64px}.impact .terminal-orbit{width:min(70vw,940px)}.impact .terminal-orbit:after{border-width:5px;border-left-color:var(--loader-orange)}.impact .terminal-ghost{top:-9vh;bottom:auto;font-size:min(43vw,610px)}.impact .terminal-brand>p:first-child{color:var(--loader-orange)}.impact .terminal-wordmark{gap:25px;font-size:clamp(72px,10vw,145px)}.impact .terminal-wordmark span{display:grid;place-items:center;width:clamp(90px,10vw,148px);aspect-ratio:1;color:var(--loader-canvas);background:var(--loader-orange);clip-path:polygon(0 0,100% 0,100% 78%,78% 100%,0 100%);font-size:.72em;animation:terminal-block-hit .5s .1s var(--loader-ease) both}.impact .terminal-wordmark b{color:var(--loader-ink);animation:terminal-type-hit .65s .15s var(--loader-ease) both}.impact .terminal-progress{height:9px;gap:6px}.impact .terminal-progress i{background-image:repeating-linear-gradient(90deg,transparent 0 calc(20% - 3px),var(--loader-canvas) calc(20% - 3px) 20%)}.impact .terminal-meter strong{font-size:44px}.impact-slash{position:absolute;z-index:2;inset:-20%;pointer-events:none;background:var(--loader-orange);animation:terminal-slash .8s var(--loader-ease) both}.impact-particles{position:absolute;inset:0;pointer-events:none;z-index:3}.impact-particles i{position:absolute;width:2px;height:2px;background:var(--loader-orange);animation:terminal-particle 1s ease-out both}.app-boot:not(.motion-ready) *,.app-boot:not(.motion-ready) *:before,.app-boot:not(.motion-ready) *:after{animation-play-state:paused!important}
.has-error .terminal-scan{display:none}.has-error .terminal-progress i,.is-ready .terminal-progress i{animation:none}
@keyframes terminal-orbit{from{transform:rotate(-38deg)}to{transform:rotate(285deg)}}@keyframes terminal-orbit-slow{to{transform:rotate(1turn)}}@keyframes terminal-orbit-fast{to{transform:rotate(1turn)}}@keyframes terminal-brand-in{from{transform:translateY(35%);opacity:0}to{transform:none;opacity:1}}@keyframes terminal-signal{50%{opacity:.4}}@keyframes terminal-block-hit{from{opacity:0;transform:scale(1.6) rotate(8deg)}70%{opacity:1;transform:scale(.92)}to{transform:none}}@keyframes terminal-type-hit{from{opacity:0;transform:translateX(-35%)}70%{opacity:1;transform:translateX(4%)}to{transform:none}}@keyframes terminal-slash{0%{transform:translateX(-118%) skewX(-18deg)}42%{transform:translateX(-72%) skewX(-18deg)}100%{transform:translateX(120%) skewX(-18deg)}}@keyframes terminal-particle{from{opacity:0;transform:translate(-25px,20px)}20%{opacity:.8}to{opacity:0;transform:translate(55px,-20px)}}
/* Loading style (standard/impact) and app colour theme are independent axes. */
.app-boot{--loader-canvas:#101715;--loader-surface:#17211e;--loader-ink:#f3f0e8;--loader-muted:#b3b9b0;--loader-faint:#8a938b;--loader-line:#dce8df1a;--loader-grid:#dce8df0a;--loader-orbit:#8fbba422;--loader-orbit-strong:#8fbba438;--loader-complete:#a6cdbf;--loader-orange:var(--color-orange,#ed6436);color:var(--loader-ink);background:var(--loader-canvas)}
:global(:root[data-theme="xuanzhi"] .app-boot){--loader-canvas:#1c1b17;--loader-surface:#27241e;--loader-ink:#f6f0e3;--loader-muted:#c5baa7;--loader-faint:#988f81;--loader-line:#f0e3ca1c;--loader-grid:#f0e3ca0a;--loader-orbit:#c5ad8128;--loader-orbit-strong:#c5ad8140;--loader-complete:#c6b99f}
:global(:root[data-theme="moye"] .app-boot){--loader-canvas:#0c100e;--loader-surface:#141a17;--loader-ink:var(--color-ink,#eeefe7);--loader-muted:var(--color-muted,#b0b8b1);--loader-faint:#879189;--loader-line:#eef2ee1c;--loader-grid:#eef2ee0a;--loader-orbit:#83c4ae24;--loader-orbit-strong:#83c4ae3d;--loader-complete:var(--color-jade,#83c4ae)}
.app-boot.impact{--loader-orange:color-mix(in srgb,var(--color-orange,#ed6436) 55%,#ff4f32)}
.boot-header{border-color:var(--loader-line)}.boot-header>span:not(.brand-logo),.terminal-brand>p:first-child,.terminal-brand>small,.terminal-motto,.boot-current>span,.terminal-meter,.terminal-meter small,.boot-note,.boot-footer{color:var(--loader-muted)}
.boot-header :deep(.brand-archive-mark),.boot-header :deep(.brand-wordmark),.boot-header :deep(.brand-latin){color:var(--loader-ink)}.boot-header .boot-demo{border-color:var(--loader-orange);color:var(--loader-orange)!important}
.terminal-ghost{color:color-mix(in srgb,var(--loader-ink) 4%,transparent)}.terminal-meter strong,.boot-steps li.active{color:var(--loader-ink)}.terminal-progress i{background-color:var(--loader-line)}.boot-steps li{border-color:var(--loader-line);color:var(--loader-faint)}.boot-steps li.complete{color:var(--loader-complete)}.active>b{color:var(--loader-orange)}
.boot-footer{border-color:var(--loader-line);background:color-mix(in srgb,var(--loader-canvas) 78%,transparent)}.boot-actions button{color:var(--loader-ink);border-color:color-mix(in srgb,var(--loader-muted) 68%,transparent)}.boot-actions button:hover{border-color:var(--loader-orange);background:color-mix(in srgb,var(--loader-orange) 12%,transparent)}.boot-actions button.primary{color:var(--loader-canvas);background:var(--loader-orange);border-color:var(--loader-orange)}.boot-actions button:focus-visible{outline-color:var(--loader-orange)}
@media(max-width:850px){.boot-body{padding:28px 36px;gap:36px}.boot-console{column-gap:32px}}@media(max-width:650px){.boot-console{display:block}.boot-steps{margin-top:24px}.boot-body{justify-content:start;padding:24px}.terminal-brand>small{letter-spacing:.2em}}@media(max-height:650px){.boot-body{justify-content:start;gap:24px}.terminal-wordmark,.impact .terminal-wordmark{font-size:66px}.terminal-motto{display:none}.impact .terminal-wordmark span{width:80px}}
.reduce-motion *,.reduce-motion *:before,.reduce-motion *:after{animation:none!important;transition:none!important}.reduce-motion .impact-slash,.reduce-motion .impact-particles,.reduce-motion .terminal-scan{display:none}
@media (prefers-reduced-motion: reduce){.impact-slash,.impact-particles,.terminal-scan{display:none}}
</style>

<style scoped src="../../../assets/approved-loading.css"></style>

<style scoped>
/* Keep the live status and its space, without flashing a success panel. */
.app-boot.is-ready:not(.has-error) .boot-current { opacity: 0; }
</style>
