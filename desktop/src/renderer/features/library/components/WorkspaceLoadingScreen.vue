<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import BrandLogo from '../../../ui/BrandLogo.vue'
import { useWorkspaceLoadingSounds } from '../../../app/composables/useWorkspaceLoadingSounds'

type WorkspaceLoadingPhase = 'switch' | 'database' | 'workspace' | 'chapter' | 'recovery' | 'ready'
const props = withDefaults(defineProps<{ title: string; phase: WorkspaceLoadingPhase; slow: boolean; theme?: 'standard' | 'impact'; reducedMotion?: boolean; preview?: boolean; error?: string; sidebarWidth?: number; quick?: boolean }>(), { theme: 'impact', reducedMotion: false, preview: false, quick: false, error: '', sidebarWidth: 248 })
defineEmits<{ cancel: []; retry: [] }>()
useWorkspaceLoadingSounds(() => ({ phase: props.phase, error: props.error, impact: props.theme === 'impact', quick: props.quick, reduced: props.reducedMotion }))
const cancelButton = ref<HTMLButtonElement | null>(null)
const archiveStage = ref<HTMLElement | null>(null)
const progressLine = ref<HTMLElement | null>(null)
const lineMovingForward = ref(true)
const sidebarHandoffStyle = ref<Record<string, string>>({})
const LINE_START_PERCENT = 5
const LINE_PATROL_DURATION_MS = 1350
const LINE_COMPLETION_DURATION_MS = 1000
// Only the owning workspace lifecycle advances these steps. No timer or fabricated percent.
const steps: Array<{ id: WorkspaceLoadingPhase; label: string; detail: string }> = [
  { id: 'switch', label: '交接作品', detail: '收尾上一部作品的后台任务' },
  { id: 'database', label: '读取本地档案', detail: '检查作品的数据模式与正文记录' },
  { id: 'workspace', label: '载入故事资料', detail: '读取总纲、时间线、人物与设定' },
  { id: 'chapter', label: '打开当前章节', detail: '恢复章节、章纲与写作上下文' },
  { id: 'recovery', label: '核对本机草稿', detail: '检查尚未完成保存的恢复副本' },
  { id: 'ready', label: '进入写作工作台', detail: '本次作品载入已经完成' },
]
const activeIndex = computed(() => Math.max(0, steps.findIndex(step => step.id === props.phase)))
const current = computed(() => steps[activeIndex.value]!)
const isComplete = (index: number) => index < activeIndex.value || (!props.error && props.phase === 'ready')
const progressPercent = computed(() => Math.round(((activeIndex.value + 1) / steps.length) * 100))
const watermarkTitle = computed(() => Array.from(props.title.trim() || '未命名作品').filter(character => character.trim()).slice(0, 5).join(''))

function moveProgressLine() {
  const line = progressLine.value
  if (!line || props.error) return
  const parentLeft = line.parentElement?.getBoundingClientRect().left ?? 0
  const currentLeft = line.getBoundingClientRect().left - parentLeft
  line.style.transitionDuration = '0ms'
  line.style.left = `${currentLeft}px`
  line.getBoundingClientRect()
  line.style.transitionDuration = `${props.quick ? 160 : props.phase === 'ready' ? LINE_COMPLETION_DURATION_MS : LINE_PATROL_DURATION_MS}ms`
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

function prepareSidebarHandoff() {
  if (typeof window === 'undefined' || props.reducedMotion) return
  const bounds = archiveStage.value?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  const targetTop = 48
  const targetWidth = Math.min(window.innerWidth, 72 + props.sidebarWidth)
  const targetHeight = Math.max(1, window.innerHeight - targetTop - 24)
  sidebarHandoffStyle.value = {
    '--sidebar-handoff-x': `${-bounds.left}px`,
    '--sidebar-handoff-y': `${targetTop - bounds.top}px`,
    '--sidebar-handoff-scale-x': String(targetWidth / bounds.width),
    '--sidebar-handoff-scale-y': String(targetHeight / bounds.height),
  }
}

watch(() => [props.phase, props.sidebarWidth], ([phase]) => {
  if (phase === 'ready') prepareSidebarHandoff()
  else sidebarHandoffStyle.value = {}
}, { flush: 'sync' })
watch([progressPercent, () => props.error], moveProgressLine, { flush: 'post' })
onMounted(() => {
  cancelButton.value?.focus({ preventScroll: true })
  moveProgressLine()
  if (props.phase === 'ready') prepareSidebarHandoff()
})
</script>

<template>
  <section class="workspace-loading" role="dialog" aria-modal="true" aria-labelledby="workspace-loading-title" data-testid="workspace-loading" :data-loading-phase="phase" :data-loading-quick="quick" :data-loader-progress="progressPercent" :data-loader-theme="theme" :class="[theme, { 'quick-entry': quick, 'reduce-motion': reducedMotion, 'has-error': !!error, 'is-ready': phase === 'ready' }]" @keydown.esc.stop.prevent="$emit('cancel')">
    <div class="archive-diagonal" aria-hidden="true"></div><div ref="progressLine" class="archive-beam" data-testid="workspace-progress-line" aria-hidden="true" @transitionend="continueProgressPatrol"></div>
    <header class="archive-header">
      <BrandLogo />
      <span class="archive-channel">作品档案 / ARCHIVE ACCESS</span><span v-if="preview" class="archive-preview" data-testid="workspace-loading-preview">动画预览 · 非真实载入</span>
      <button ref="cancelButton" type="button" data-testid="cancel-workspace-loading" data-sound="back" @click="$emit('cancel')">{{ preview ? '关闭预览' : '返回我的作品' }} <span aria-hidden="true">↗</span></button>
    </header>
    <div class="archive-body">
      <aside ref="archiveStage" class="archive-stage" :style="sidebarHandoffStyle" aria-label="正在打开的作品">
        <div class="archive-stage-label"><span>SELECTED DOSSIER</span><span>本地作品</span></div>
        <span class="archive-seal" aria-hidden="true">{{ theme === 'impact' ? 'UNSEAL' : 'OPEN' }}</span>
        <div class="archive-book"><div><small>{{ preview ? '作品档案示意' : '正在解封的作品' }}</small><h2>{{ title }}</h2></div></div>
        <p class="archive-stage-note">每个故事，都有值得继续的一页。</p>
        <div class="archive-dossier-meta"><span>LOCAL ARCHIVE</span><span>LANJIAN / 02</span></div>
      </aside>
      <main class="archive-progress">
        <p class="archive-compact-title">{{ title }}</p>
        <div class="archive-watermark" data-testid="workspace-title-watermark" aria-hidden="true"><span>{{ watermarkTitle }}</span></div>
        <p class="archive-eyebrow"><span aria-hidden="true"></span>作品档案解封</p>
        <h1 id="workspace-loading-title">{{ theme === 'impact' ? '作品上下文装填' : '正在展开作品档案' }}</h1>
        <p class="archive-current" role="status" aria-live="polite" aria-atomic="true"><b>{{ error ? '作品载入需要处理' : current.label }}</b><span>{{ error ? '原稿不变，可以返回作品库后重新打开。' : current.detail }}</span></p>
        <div class="archive-tree-head"><span>本次载入流程</span><span>阶段 {{ activeIndex + 1 }} / {{ steps.length }}</span></div>
        <ol class="archive-tree" aria-label="作品载入阶段">
          <li v-for="(step, index) in steps" :key="step.id" :class="{ complete: isComplete(index), active: index === activeIndex }" :aria-current="index === activeIndex ? 'step' : undefined">
            <span class="tree-node" aria-hidden="true">{{ isComplete(index) ? '✓' : String(index + 1).padStart(2, '0') }}</span>
            <div><b>{{ step.label }}</b><small>{{ step.detail }}</small></div>
            <span class="tree-status">{{ isComplete(index) ? '已完成' : index === activeIndex ? error ? '待处理' : '进行中' : '待处理' }}</span>
          </li>
        </ol>
        <div class="archive-phase-meter" aria-hidden="true"><i v-for="(_, index) in steps" :key="index" :class="{ complete: isComplete(index), active: index === activeIndex }"></i></div>
        <section v-if="error" class="archive-error" role="alert"><p>{{ error }}</p><button type="button" data-testid="workspace-loading-retry" @click="$emit('retry')">重新尝试</button></section>
        <p class="archive-footnote">进度只取自真实载入阶段；完成后用一秒将档案交接到写作边栏。</p>
      </main>
    </div>
    <footer class="archive-footer"><span>本地档案 · 由你掌握</span><span>LANJIAN / NARRATIVE TERMINAL</span></footer>
  </section>
</template>

<style scoped>
.workspace-loading { position: fixed; inset: 0; z-index: 5000; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; color: var(--color-ink, #1d2220); background: var(--color-paper, #f3f0e8); font-family: var(--sans, "Microsoft YaHei UI", sans-serif); }
.archive-header { display: flex; align-items: center; gap: 24px; min-height: 72px; padding: 12px 32px; border-bottom: 1px solid var(--color-line, #d8d6cf); }
.archive-channel { flex: 1; font-size: 11px; letter-spacing: .12em; color: var(--color-muted, #777c78); }
.archive-header button { display: flex; align-items: center; gap: 24px; flex-shrink: 0; min-height: 40px; padding: 8px 16px; border: 1px solid var(--color-line, #d8d6cf); border-radius: 2px; background: var(--color-surface, #faf9f5); color: var(--color-ink, #1d2220); font: 600 13px/1.4 var(--sans, sans-serif); cursor: pointer; }
.archive-header button:hover { background: var(--color-ink, #1d2220); color: var(--color-surface, #faf9f5); }.archive-header button:focus-visible { outline: 3px solid var(--color-jade, #287a68); outline-offset: 3px; }
.archive-body { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(400px, 1.25fr); min-height: 0; overflow: auto; }
.archive-stage { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 32px clamp(24px, 4vw, 64px); background: var(--color-rail, #eae8e0); color: var(--color-ink, #1d2220); border-right: 1px solid var(--color-line, #d8d6cf); }
.archive-stage-label { display: flex; justify-content: space-between; gap: 16px; color: var(--color-muted, #646c68); font-size: 11px; line-height: 1.5; letter-spacing: .1em; }
.archive-art { position: relative; flex: 1; min-height: 210px; max-height: 430px; margin-block: 24px; overflow: hidden; border-block: 1px solid var(--color-line, #d8d6cf); background-image: linear-gradient(color-mix(in srgb, var(--color-ink, #1d2220) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-ink, #1d2220) 4%, transparent) 1px, transparent 1px); background-size: 32px 32px; }
.archive-map { position: absolute; width: 100%; height: 100%; stroke: color-mix(in srgb, var(--color-jade, #287a68) 45%, var(--color-rail, #eae8e0)); stroke-width: 1.2; }.archive-map .map-contour { opacity: .4; }.archive-map circle { fill: var(--color-rail, #eae8e0); stroke: var(--color-jade, #287a68); }
.archive-character { position: absolute; height: 94%; max-width: 78%; bottom: -4%; left: 50%; transform: translateX(-50%); opacity: .86; }
.archive-corner { position: absolute; z-index: 1; padding: 4px 8px; background: var(--color-rail, #eae8e0); color: var(--color-muted, #626b65); font-size: 10px; line-height: 1.6; letter-spacing: .08em; }.archive-corner.top { top: 8px; left: 0; }.archive-corner.bottom { bottom: 8px; right: 0; }
.archive-book { display: flex; align-items: flex-start; gap: 16px; padding-top: 8px; }.archive-book-mark { display: grid; place-items: center; flex: 0 0 48px; height: 64px; border-left: 4px solid var(--color-jade, #287a68); background: var(--color-surface, #faf9f5); font: 24px/1 var(--serif, serif); box-shadow: 3px 3px 0 var(--color-line, #d8d6cf); }
.archive-book small { color: var(--color-muted, #646c68); font-size: 11px; }.archive-book h2 { margin: 8px 0 0; font: 600 clamp(18px, 2vw, 26px)/1.4 var(--serif, serif); overflow-wrap: anywhere; }.archive-stage-note { margin: 24px 0 0; color: var(--color-muted, #646c68); font-size: 12px; line-height: 1.8; }
.archive-progress { align-self: center; min-width: 0; padding: 32px clamp(24px, 5vw, 80px); }.archive-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-size: 12px; letter-spacing: .16em; }.archive-eyebrow > span { width: 24px; height: 3px; background: var(--color-orange, #e99a35); }
.archive-progress h1 { margin: 0; font: 600 clamp(24px, 3vw, 38px)/1.4 var(--serif, serif); }.archive-progress h1 > span { color: var(--color-jade, #287a68); }
.archive-current { display: grid; gap: 8px; margin: 24px 0 32px; padding-left: 16px; border-left: 3px solid var(--color-jade, #287a68); }.archive-current b { font-size: 15px; }.archive-current > span { font-size: 12px; color: var(--color-muted, #626b65); line-height: 1.6; }
.archive-tree-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--color-line, #d8d6cf); font-size: 11px; color: var(--color-muted, #626b65); }
.archive-tree { margin: 0; padding: 8px 0; list-style: none; }.archive-tree li { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 16px; align-items: center; min-height: 64px; color: var(--color-muted, #777c78); }.archive-tree li:not(:last-child)::after { content: ''; position: absolute; top: calc(50% + 14px); bottom: calc(-50% + 14px); left: 13px; border-left: 1px solid var(--color-line, #d8d6cf); }
.tree-node { position: relative; display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--color-line, #d8d6cf); font: 11px/1 monospace; background: var(--color-paper, #f3f0e8); }.archive-tree li > div { display: grid; gap: 4px; padding-block: 8px; }.archive-tree b { font-size: 13px; font-weight: 500; }.archive-tree small { font-size: 11px; line-height: 1.5; }.tree-status { font-size: 10px; white-space: nowrap; }
.archive-tree li.complete { color: var(--color-jade, #287a68); }.complete .tree-node { border-color: var(--color-jade, #287a68); }.archive-tree li.active { color: var(--color-ink, #1d2220); }.active .tree-node { background: var(--color-ink, #1d2220); border-color: var(--color-ink, #1d2220); color: var(--color-surface, #faf9f5); }.active .tree-status { padding: 4px 6px; background: color-mix(in srgb, var(--color-orange, #e99a35) 11%, var(--color-paper, #f3f0e8)); color: var(--color-ink, #1d2220); }
.active:not(.complete) .tree-node::before { content: ''; position: absolute; inset: -4px; border-top: 2px solid var(--color-orange, #e99a35); animation: archive-signal 1.8s ease-in-out infinite; }
.archive-footnote { margin: 16px 0 0; font-size: 11px; color: var(--color-muted, #626b65); line-height: 1.7; }
.archive-footer { display: flex; justify-content: space-between; gap: 16px; padding: 12px 32px; border-top: 1px solid var(--color-line, #d8d6cf); color: var(--color-muted, #626b65); font-size: 10px; letter-spacing: .1em; }
@keyframes archive-signal { 50% { opacity: .2; } }
@media (max-width: 860px) { .archive-body { grid-template-columns: minmax(230px, .85fr) minmax(360px, 1.2fr); }.archive-stage, .archive-progress { padding: 24px; }.archive-channel { display: none; }.archive-header { justify-content: space-between; } }
@media (max-width: 650px) { .archive-body { display: block; }.archive-stage { padding: 16px 24px; border-right: 0; border-bottom: 1px solid var(--color-line, #d8d6cf); }.archive-art, .archive-stage-note, .archive-stage-label { display: none; }.archive-book { padding: 0; }.archive-book-mark { height: 48px; }.archive-book h2 { margin-top: 4px; }.archive-header { padding: 12px 16px; gap: 12px; }.archive-header button { gap: 8px; padding-inline: 12px; }.archive-footer { padding-inline: 16px; }.archive-footer span:last-child { display: none; }.archive-current { margin-block: 16px 24px; } }
@media (max-height: 700px) and (min-width: 651px) { .archive-progress { align-self: start; padding-block: 24px; }.archive-current { margin-block: 16px 20px; }.archive-tree li { min-height: 54px; }.archive-stage { padding-block: 24px; }.archive-stage-label, .archive-stage-note { display: none; }.archive-book { order: -1; }.archive-art { flex: none; height: 260px; min-height: 180px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
/* Approved dossier layouts. The demo's fake editor and timer-driven READY are intentionally not data sources. */
.workspace-loading{--loader-orange:var(--color-orange,#ed6436);--loader-ease:cubic-bezier(.22,.8,.25,1);background:var(--loader-canvas);color:var(--loader-ink);background-image:linear-gradient(color-mix(in srgb,var(--loader-ink) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--loader-ink) 5%,transparent) 1px,transparent 1px);background-size:42px 42px}
.archive-header,.archive-body,.archive-footer{position:relative;z-index:5}.archive-header{border-bottom:1px solid #1d2c2730;min-height:80px;background:#eeeae0ed}.archive-preview{padding:6px 10px;border:1px solid #ba6842;font:11px/1.5 var(--sans,sans-serif);color:#853817}.archive-body{grid-template-columns:minmax(280px,.95fr) minmax(340px,1.2fr);gap:clamp(32px,6vw,90px);align-items:center;padding:clamp(32px,6vh,70px) clamp(32px,8vw,128px)}
.archive-stage{align-self:center;min-height:380px;max-height:none;display:flex;justify-content:center;padding:38px 32px;color:#ece9df;background:#17211e;border:0;box-shadow:0 30px 80px #1b262238;animation:dossier-enter .55s var(--loader-ease) both}
.archive-stage:before{content:'';position:absolute;left:0;top:0;width:6px;height:72px;background:var(--loader-orange)}.archive-stage-label{position:absolute;top:30px;left:32px;right:32px;display:flex!important;color:#adc2b8;letter-spacing:.14em;font:9px/1.5 monospace}.archive-stage-label span:last-child{display:none}.archive-seal{position:absolute;top:29px;right:25px;width:48px;height:48px;display:grid;place-items:center;border:1px solid var(--loader-orange);color:var(--loader-orange);transform:rotate(-9deg);font:700 9px/1 monospace;letter-spacing:.08em}.archive-book{padding:0!important;order:initial!important}.archive-book small{color:#adb7b0;font-size:11px}.archive-book h2{margin:16px 0!important;font:500 clamp(27px,3vw,46px)/1.28 var(--serif,serif);overflow-wrap:anywhere;color:#ece9df}.archive-stage-note{display:block!important;margin:0;font-size:12px;line-height:1.7;color:#b8bdb4;letter-spacing:.06em}.archive-dossier-meta{position:absolute;left:32px;right:32px;bottom:24px;display:flex;justify-content:space-between;padding-top:16px;border-top:1px solid #ffffff20;color:#abb4ab;font:9px/1.5 monospace;letter-spacing:.12em}
.archive-progress{position:relative;isolation:isolate;container-type:inline-size;overflow:hidden;padding:0;align-self:center;animation:archive-rise .45s .12s var(--loader-ease) both}.archive-progress>:not(.archive-watermark){position:relative;z-index:1}.archive-eyebrow{font-size:10px;color:#8d4b2c;letter-spacing:.14em}.archive-eyebrow>span{background:var(--loader-orange)}.archive-progress h1{font-weight:500;font-size:clamp(23px,2.5vw,34px);line-height:1.4;color:#17211e}.archive-current{margin:20px 0 24px;border-color:var(--loader-orange)}.archive-current>span{color:#58645d}.archive-tree-head{border-color:#1d2c2730;color:#58645d}.archive-tree li{min-height:55px;gap:12px;color:#58645d}.archive-tree li.complete{color:#28715f}.archive-tree li.active{color:#17211e}.tree-node{background:#eeeae0;border-color:#a9afa4}.archive-tree b{font-size:12px}.archive-tree small{font-size:11px}.archive-tree li:not(:last-child):after{border-color:#a9afa4}.active .tree-node{background:#17211e;color:#eeeae0;border-color:#17211e}.active:not(.complete) .tree-node:before{border-color:var(--loader-orange)}.tree-status{color:inherit}.archive-phase-meter{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;height:3px;margin-top:16px}.archive-phase-meter i{background:#1d2c271a}.archive-phase-meter i.complete{background:#3d7669}.archive-phase-meter i.active{background:var(--loader-orange);animation:archive-signal 1.8s ease-in-out infinite}.archive-footnote{color:#58645d}.archive-footer{background:#eeeae0ed;color:#58645d;border-color:#1d2c2730}
.archive-diagonal,.archive-beam{position:absolute;pointer-events:none}.archive-watermark{position:absolute;z-index:0;inset:auto 0 0;display:flex;align-items:flex-end;justify-content:flex-end;height:48%;min-width:0;overflow:hidden;pointer-events:none;color:#1f2d2814}.archive-watermark span{display:block;max-inline-size:100%;font:900 clamp(42px,11cqw,96px)/.78 monospace;letter-spacing:-.08em;white-space:nowrap}.archive-diagonal{display:none}.archive-beam{z-index:4;top:0;bottom:0;left:5%;width:2px;opacity:.28;background:linear-gradient(180deg,transparent 4%,var(--loader-orange) 24% 76%,transparent 96%);box-shadow:0 0 14px color-mix(in srgb,var(--loader-orange) 42%,transparent);transition-property:left,opacity;transition-timing-function:linear}
.impact{--loader-orange:color-mix(in srgb,var(--color-orange,#ed6436) 55%,#ff4f32);background-color:var(--loader-canvas);background-size:44px 44px}.impact .archive-diagonal{display:block;left:-12%;top:-30%;width:44%;height:160%;background:var(--loader-dossier);transform:skewX(-12deg)}.impact .archive-stage{background:var(--loader-dossier);min-height:430px;clip-path:polygon(0 0,100% 0,100% 84%,88% 100%,0 100%);animation:archive-hit .48s .05s var(--loader-ease) both}.impact .archive-stage:before{width:9px;height:100%;animation:archive-drop .35s .2s var(--loader-ease) both;transform-origin:top}.impact .archive-book h2{font-size:clamp(31px,3.6vw,52px)}.impact .archive-seal{width:60px;height:60px;border-width:2px;animation:archive-stamp .3s .32s var(--loader-ease) both}.impact .archive-progress{animation:archive-rise .3s .12s var(--loader-ease) both}.impact .archive-phase-meter{height:7px;gap:5px}.impact .archive-header,.impact .archive-footer{background:color-mix(in srgb,var(--loader-canvas) 95%,transparent)}
.archive-error{padding:12px 16px;border-left:3px solid #b4473e;background:#b4473e0f;color:#8a332b;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.archive-error p{margin:0 0 12px}.archive-error button{padding:8px 16px;border:1px solid #8a332b;background:#faf9f5;color:#8a332b;cursor:pointer;font:600 12px/1.5 var(--sans,sans-serif)}.archive-error button:focus-visible{outline:3px solid #8a332b;outline-offset:3px}.has-error .archive-beam{display:none}.has-error .archive-phase-meter i,.is-ready .archive-phase-meter i{animation:none}.is-ready:not(.has-error) .archive-stage{z-index:8;transform-origin:left top;animation:archive-to-sidebar 1s var(--loader-ease) both}.is-ready:not(.has-error) .archive-stage :is(.archive-stage-label,.archive-seal,.archive-book,.archive-stage-note,.archive-dossier-meta){animation:archive-stage-content-out .32s ease both}.is-ready:not(.has-error) .archive-diagonal{animation:archive-diagonal-out .55s ease both}
@keyframes dossier-enter{from{opacity:0;transform:translateX(-45px) skewX(-2deg)}to{opacity:1;transform:none}}@keyframes archive-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes archive-hit{from{opacity:0;transform:translateX(-45%) rotate(-3deg)}75%{transform:translateX(3%)}to{opacity:1;transform:none}}@keyframes archive-drop{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes archive-stamp{from{opacity:0;transform:rotate(-9deg) scale(1.7)}70%{opacity:1;transform:rotate(-9deg) scale(.9)}to{opacity:1;transform:rotate(-9deg) scale(1)}}@keyframes archive-to-sidebar{0%{transform:none;clip-path:polygon(0 0,100% 0,100% 86%,88% 100%,0 100%);background:var(--loader-dossier)}58%{clip-path:polygon(0 0,100% 0,100% 94%,96% 100%,0 100%)}100%{transform:translate(var(--sidebar-handoff-x,0),var(--sidebar-handoff-y,0)) scale(var(--sidebar-handoff-scale-x,1),var(--sidebar-handoff-scale-y,1));clip-path:polygon(0 0,100% 0,100% 100%,0 100%);background:linear-gradient(90deg,var(--color-rail,#e5e5df) 0 22%,var(--color-paper,#f3f0e8) 22% 100%);box-shadow:none}}@keyframes archive-stage-content-out{to{opacity:0;transform:translateX(-12px)}}@keyframes archive-diagonal-out{to{opacity:0;transform:translateX(-18%) skewX(-12deg)}}
/* App colour theme adapts the loader palette without changing its selected motion style. */
.workspace-loading{--loader-canvas:var(--color-paper,#f3f0e8);--loader-surface:var(--color-surface,#faf9f5);--loader-ink:var(--color-ink,#1d2220);--loader-muted:var(--color-muted,#676e69);--loader-line:var(--color-line,#d8d6cf);--loader-jade:var(--color-jade,#287a68);--loader-danger:var(--color-danger,#b4473e);--loader-dossier:#17211e;--loader-dossier-ink:#ece9df;--loader-dossier-muted:#adb7b0}
:global(:root[data-theme="xuanzhi"] .workspace-loading){--loader-dossier:#29251f;--loader-dossier-ink:#f3ead9;--loader-dossier-muted:#c1b5a2}
:global(:root[data-theme="moye"] .workspace-loading){--loader-dossier:#101513;--loader-dossier-ink:var(--color-ink,#eeefe7);--loader-dossier-muted:var(--color-muted,#b0b8b1)}
.archive-header,.archive-footer{border-color:color-mix(in srgb,var(--loader-line) 78%,transparent);background:color-mix(in srgb,var(--loader-canvas) 95%,transparent)}.archive-preview{border-color:var(--loader-orange);color:color-mix(in srgb,var(--loader-orange) 62%,var(--loader-ink))}
.archive-stage,.impact .archive-stage{color:var(--loader-dossier-ink);background:var(--loader-dossier);box-shadow:0 30px 80px color-mix(in srgb,var(--loader-dossier) 22%,transparent)}.archive-stage-label,.archive-book small,.archive-stage-note,.archive-dossier-meta{color:var(--loader-dossier-muted)}.archive-book h2{color:var(--loader-dossier-ink)}.archive-progress h1,.archive-tree li.active{color:var(--loader-ink)}.archive-dossier-meta{border-color:color-mix(in srgb,var(--loader-dossier-ink) 14%,transparent)}
.archive-eyebrow{color:color-mix(in srgb,var(--loader-orange) 64%,var(--loader-ink))}.archive-current>span,.archive-tree-head,.archive-tree li,.archive-footnote,.archive-footer{color:color-mix(in srgb,var(--loader-muted) 80%,var(--loader-ink))}.archive-tree-head,.archive-footer{border-color:var(--loader-line)}.archive-tree li.active{animation:archive-phase-enter .16s ease-out both}.archive-tree li.complete{color:var(--loader-jade)}.archive-tree li:not(:last-child):after{border-color:var(--loader-line)}.tree-node{color:color-mix(in srgb,var(--loader-muted) 80%,var(--loader-ink));background:var(--loader-canvas);border-color:var(--loader-line)}.active .tree-node{color:var(--loader-surface);background:var(--loader-ink);border-color:var(--loader-ink)}
.archive-phase-meter i{background:color-mix(in srgb,var(--loader-ink) 10%,transparent)}.archive-phase-meter i.complete{background:var(--loader-jade)}.archive-watermark{color:color-mix(in srgb,var(--loader-ink) 8%,transparent)}.archive-error{border-color:var(--loader-danger);background:color-mix(in srgb,var(--loader-danger) 7%,var(--loader-canvas));color:var(--loader-danger)}.archive-error button{border-color:var(--loader-danger);background:var(--loader-surface);color:var(--loader-danger)}
@keyframes archive-phase-enter{from{opacity:.72}to{opacity:1}}
@media(max-width:950px){.archive-body{gap:28px;padding:32px}.archive-stage{padding:32px 24px}.archive-book h2{font-size:30px}.archive-stage-label,.archive-dossier-meta{left:24px;right:24px}.archive-progress h1{font-size:25px}}@media(max-width:700px){.archive-body{display:block;padding:24px;overflow:auto}.archive-stage,.impact .archive-stage{min-height:240px;margin-bottom:24px;max-height:none;padding:72px 24px 65px}.archive-book h2,.impact .archive-book h2{font-size:27px}.archive-stage-note{display:none!important}.archive-diagonal{display:none!important}.archive-progress{padding:0}.archive-header{flex-wrap:wrap;min-height:72px}.archive-preview{order:3;width:100%}.archive-tree li{min-height:55px}}@media(max-height:700px) and (min-width:701px){.archive-body{align-items:start;padding-block:24px}.archive-stage,.impact .archive-stage{min-height:340px}.archive-progress{align-self:start;padding:0}.archive-tree li{min-height:49px}.archive-current{margin-block:16px}.archive-stage-label{display:flex}.archive-book{order:initial}}
.reduce-motion *,.reduce-motion *:before,.reduce-motion *:after{animation:none!important;transition:none!important}.reduce-motion .archive-beam{display:none}
@media (prefers-reduced-motion: reduce){.archive-beam{display:none}}
.quick-entry :is(.archive-stage,.archive-stage:before,.archive-seal,.archive-progress,.archive-current,.archive-tree li){animation-duration:.16s!important;animation-delay:0s!important}
</style>

<style scoped src="../../../assets/approved-loading.css"></style>
