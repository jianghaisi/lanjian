<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import BrandMark from '../../../ui/BrandMark.vue'
import LibraryArchiveHero from '../../../features/library/components/LibraryArchiveHero.vue'
import { selectContinueProject } from '../../../features/library/composables/continue-project'
import { dossierArrivalKey } from '../../../features/library/composables/dossier-arrival'
import type { ProjectSummary } from '../../../../contracts/index'
import { advanceCinematic, advanceArrayWait, repeatWaveTime, rectTransform, ARRAY_GATE, cinematicStage, ease, HANDOFF_DURATION, interpolateRect, progress, typed, scanScale, shutterOffset, handoffPress, CINEMATIC_DURATION, type ScreenRect } from './cinematic-timeline'
import type { ArchiveScene } from './archive-scene'
import { useBootSounds } from '../../composables/useBootSounds'
import { useUiSounds } from '../../composables/useUiSounds'

const props=withDefaults(defineProps<{
  phase:'projects'|'editor'|'session'|'models'|'ready'; error?:string; detail?:string;
  modelsRequired?:boolean; canSkipModels?:boolean; preview?:boolean;
  theme?:'standard'|'impact'; bootStyle?:'cinematic'|'brief'; palette?:'system'|'light'|'dark'; reducedMotion?:boolean; projects?:ProjectSummary[]; continueProjectId?:string|null
}>(),{error:'',detail:'',preview:false,reducedMotion:false,bootStyle:'cinematic',palette:'system',projects:()=>[]})
const emit=defineEmits<{complete:[];skip:[];retry:[];skipModels:[];visualReady:[]}>()
const arrival=inject(dossierArrivalKey,null)
const root=ref<HTMLElement|null>(null)
const browser=window.novelDesktop?.app.platform==='browser'
const soundActivated=ref(false)
const {player:soundPlayer}=useUiSounds()
function enableSound(){soundActivated.value=true;void soundPlayer.unlock()}
const canvas=ref<HTMLCanvasElement|null>(null)
const face=ref<HTMLElement|null>(null)
const seconds=ref(0)
const handoff=ref(-1)
const arrayWait=ref<number|null>(null)
const skipRequested=ref(false)
const bypass=ref(-1)
const sceneReleased=ref(false)
const visible=ref(false)
const systemReduced=ref(false)
const sceneState=ref<'loading'|'ready'|'fallback'>('loading')
const dark=ref(false)
const selection=shallowRef<ProjectSummary|undefined>()
const selectionFrozen=ref(false)
const faceBox=ref<ScreenRect>({x:0,y:0,width:1,height:1})
const sourceLayout=shallowRef<ScreenRect>()
const destinationLayout=shallowRef<ScreenRect>()
let scene:ArchiveScene|undefined
let raf=0, last=0, disposed=false, completed=false, sceneTimeout:ReturnType<typeof setTimeout>|undefined
let stopShown:(()=>void)|undefined, media:MediaQueryList|undefined, themeObserver:MutationObserver|undefined
let nativeShown=false
let handoffSource:ScreenRect|undefined
let lastDestination:ScreenRect|undefined
let segmentStart=.15
let targetObserver:ResizeObserver|undefined, targetDirty=true, faceMeasureDirty=true, lastFaceTime=-1
let observedTarget:HTMLElement|undefined
const reduced=computed(()=>props.reducedMotion||systemReduced.value||props.bootStyle==='brief')
const ready=computed(()=>(props.preview||props.phase==='ready')&&!props.error)
const stage=computed(()=>cinematicStage(seconds.value))
const entering=computed(()=>handoff.value>=0)
useBootSounds(() => ({ seconds: seconds.value, arrayWait: arrayWait.value, handoff: handoff.value, visible: visible.value,
  reduced: reduced.value, cinematic: props.bootStyle === 'cinematic', error: !!props.error, bypass: bypass.value >= 0 }))
const canSkipArray=computed(()=>props.canSkipModels&&props.phase==='models'&&!skipRequested.value&&(reduced.value||arrayWait.value!==null))
const canEnter=computed(()=>ready.value&&stage.value==='await-click'&&!entering.value)
const prepareFaces=computed(()=>seconds.value>=9&&ready.value&&arrayWait.value===null)
const realSelection=computed(()=>selectionFrozen.value ? props.projects.find(p=>p.id===selection.value?.id) : selectContinueProject(props.projects,props.continueProjectId))
const displaySelection=computed(()=>realSelection.value ?? selection.value)
const access=computed(()=>typed('ACCESS PERMISSION REQUIRED',seconds.value,.12,.55))
const identity=computed(()=>typed('AUTHOR SESSION · LOCAL',seconds.value,3.05,.65))
const identityConnection=computed(()=>typed('CONNECTING TO YOUR WORLDS',seconds.value,3.85,.7))
const shutterStart=computed(()=>seconds.value<10?8.64:11.64)
const shutterVisible=computed(()=>[8.64,11.64].some(start=>seconds.value>=start&&seconds.value<start+.8))
const status=computed(()=>props.error||(ready.value?'本地工作环境已就绪':props.phase==='models'?'正在接入本地模型':props.detail)||({projects:'正在读取本地作品',editor:'正在准备界面与字体',session:'正在准备作品入口',models:'正在准备已选择的陪伴模型',ready:'本地工作环境已就绪'}[props.phase]))
const stageLabel=computed(()=>({access:'请求接入',mark:'岚笺',identity:'接入本地创作环境',scan:'准备作品档案',welcome:'欢迎回来',array:'展开档案阵列',extract:'取出继续创作档案',inspect:'作品档案特写','await-click':'点击档案，进入我的作品'}[stage.value]))
const layoutStyle=(box:ScreenRect)=>({left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`})
const faceStyle=computed(()=>({...layoutStyle(sourceLayout.value??faceBox.value),opacity:entering.value&&destinationLayout.value?1-progress(handoff.value,.9,1):reduced.value?1:Math.max(.001,progress(seconds.value,32.4,32.7)),transform:sourceLayout.value?rectTransform(sourceLayout.value,faceBox.value):undefined}))
// Pre-rasterize the destination; an opaque reveal avoids double lettering during the layout change.
const landingStyle=computed(()=>destinationLayout.value?{...layoutStyle(destinationLayout.value),transform:rectTransform(destinationLayout.value,faceBox.value),opacity:entering.value?1:.001,clipPath:entering.value?`inset(0 ${(1-ease(progress(handoff.value,.2,.85)))*100}% 0 0)`:undefined}:undefined)
// Avoid Chromium postponing the covered library's first paint until the handoff.
const backgroundOpacity=computed(()=>entering.value ? .999*(1-ease(progress(handoff.value,.22,1.4))) : seconds.value>=12?.999:1)

function freezeSelection(){if(!selectionFrozen.value){selection.value=realSelection.value;selectionFrozen.value=true}}
function fallbackRect():ScreenRect {
  const width=Math.min(innerWidth*.67,innerHeight*.44*7.2/3.4),height=width*3.4/7.2
  return {x:(innerWidth-width)/2,y:(innerHeight-height)/2,width,height}
}
function failScene(){sceneState.value='fallback';scene?.dispose();scene=undefined}
function releaseScene(){
  const owned=scene;scene=undefined;sceneReleased.value=true
  // Resource destruction must not block the click/last visible handoff frame.
  if(owned)setTimeout(()=>owned.dispose(),50)
}
function invalidateGeometry(){targetDirty=true;faceMeasureDirty=true}
function measureDestination(){
  const target=arrival?.target.value
  if(!target?.element.isConnected||target.projectId!==(selection.value?.id??null)){destinationLayout.value=undefined;return}
  if(observedTarget!==target.element){targetObserver?.disconnect();observedTarget=target.element;targetObserver?.observe(target.element);targetDirty=true}
  if(!targetDirty)return
  const box=target.element.getBoundingClientRect()
  if(lastDestination&&['x','y','width','height'].some(key=>Math.abs(box[key as keyof ScreenRect]-lastDestination![key as keyof ScreenRect])>.5)){
    handoffSource={...faceBox.value};segmentStart=handoff.value
  }
  lastDestination={x:box.x,y:box.y,width:box.width,height:box.height}
  destinationLayout.value=lastDestination;targetDirty=false
}
function finish(){
  if(completed||disposed)return
  completed=true
  if(arrival){arrival.feedbackAfter.value=performance.now()+900;arrival.concealed.value=false}
  releaseScene()
  const target=arrival?.target.value?.element
  if(props.preview)emit('skip');else emit('complete')
  void nextTick(()=>{if(!props.preview&&target?.isConnected)target.focus({preventScroll:true})})
}
function enter(){
  if(!canEnter.value)return
  if(props.preview||reduced.value){finish();return}
  handoffSource={...faceBox.value}
  sourceLayout.value??={...faceBox.value}
  handoff.value=0
  targetDirty=true;measureDestination()
  if(arrival&&arrival.target.value?.projectId===(selection.value?.id??null))arrival.concealed.value=true
}
function skipModelsAndEnter(){
  if(!canSkipArray.value)return
  skipRequested.value=true;emit('skipModels')
}
watch(ready,value=>{if(value&&skipRequested.value)bypass.value=0})
function keyboard(event:KeyboardEvent){
  if(event.key==='Escape'&&props.preview){event.preventDefault();emit('skip')}
  else if((event.key==='Enter'||event.key===' ')&&canEnter.value){event.preventDefault();enter()}
  else if(event.key==='Tab') {
    const buttons=Array.from(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')??[]).filter(e=>!e.closest('[inert]')&&e.getClientRects().length)
    if(!buttons.length){event.preventDefault();root.value?.focus();return}
    const index=buttons.indexOf(document.activeElement as HTMLElement)
    if(event.shiftKey&&(index<=0)){event.preventDefault();buttons.at(-1)?.focus()}
    else if(!event.shiftKey&&(index<0||index===buttons.length-1)){event.preventDefault();buttons[0]?.focus()}
  }
}
function tick(now:number){
  if(disposed||completed)return
  const delta=last?Math.min((now-last)/1000,.1):0;last=now
  visible.value=nativeShown&&document.visibilityState==='visible'
  if(visible.value){
    if(bypass.value>=0){
      bypass.value=Math.min(.45,bypass.value+delta)
      if(bypass.value>=.45){finish();return}
    } else if(entering.value){
      handoff.value=Math.min(HANDOFF_DURATION,handoff.value+delta)
      measureDestination()
      if(destinationLayout.value&&handoffSource){
        const box=interpolateRect(handoffSource,destinationLayout.value,ease(progress(handoff.value,segmentStart,HANDOFF_DURATION)))
        const press=handoffPress(handoff.value)
        faceBox.value={x:box.x+box.width*(1-press)/2,y:box.y+box.height*(1-press)/2,width:box.width*press,height:box.height*press}
      }
      if(handoff.value>=HANDOFF_DURATION){
        // Commit the exact endpoint before unmounting; resize can retarget on this final tick.
        void nextTick(()=>{if(!disposed)raf=requestAnimationFrame(()=>finish())})
        return
      }
    } else {
      if(reduced.value){if(ready.value){freezeSelection();seconds.value=CINEMATIC_DURATION}else seconds.value=5}
      else if(!props.error||props.phase==='models'){
        if(arrayWait.value!==null){
          arrayWait.value=advanceArrayWait(arrayWait.value,delta,ready.value,visible.value)
          if(arrayWait.value===null)seconds.value=20
        }else{
          seconds.value=advanceCinematic(seconds.value,delta,ready.value,visible.value)
          if(seconds.value===ARRAY_GATE&&!ready.value)arrayWait.value=0
        }
      }
      if(seconds.value>=9&&(props.phase==='models'||ready.value))freezeSelection()
      if(prepareFaces.value){
        if(!sourceLayout.value){faceBox.value=fallbackRect();sourceLayout.value={...faceBox.value}}
        if(seconds.value<32.4&&faceMeasureDirty){faceBox.value=fallbackRect();faceMeasureDirty=false}
        measureDestination()
      }
      if(seconds.value>=12&&!reduced.value&&scene){try{scene.setProject(displaySelection.value);scene.render(seconds.value,dark.value,arrayWait.value===null?seconds.value:repeatWaveTime(arrayWait.value))}catch{failScene()}}
      if(seconds.value>=32.4&&(faceMeasureDirty||lastFaceTime!==seconds.value)){
        faceBox.value=scene?.faceRect()??fallbackRect();faceMeasureDirty=false;lastFaceTime=seconds.value
      }
      if(seconds.value>=32.4)measureDestination()
      if(seconds.value===CINEMATIC_DURATION&&scene)releaseScene()
    }
  }
  raf=requestAnimationFrame(tick)
}
function updateVisibility(){visible.value=nativeShown&&document.visibilityState==='visible';last=0}
function readTheme(){dark.value=props.palette==='dark'||(props.palette==='system'&&document.documentElement.dataset.theme==='moye');scene?.invalidatePalette()}
watch(()=>props.palette,readTheme)
// Project summaries can arrive after the scene's initial prepare(). Refresh their
// texture while the canvas is still covered, rather than on the reveal frame.
watch([displaySelection,dark,sceneState],()=>{
  if(!scene||reduced.value||seconds.value>=12)return
  try{scene.setProject(displaySelection.value);scene.render(12,dark.value)}catch{failScene()}
})
function updateReduced(){systemReduced.value=!!media?.matches;if(reduced.value){scene?.dispose();scene=undefined;sceneState.value='fallback'}}
watch(()=>props.reducedMotion,updateReduced)
watch(canEnter,async value=>{if(value){await nextTick();(face.value?.querySelector('button')??face.value)?.focus({preventScroll:true})}})
onMounted(()=>{
  targetObserver=new ResizeObserver(invalidateGeometry)
  window.addEventListener('resize',invalidateGeometry)
  window.addEventListener('scroll',invalidateGeometry,true)
  media=matchMedia('(prefers-reduced-motion: reduce)');updateReduced();media.addEventListener('change',updateReduced)
  document.addEventListener('visibilitychange',updateVisibility)
  readTheme();themeObserver=new MutationObserver(readTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})
  root.value?.focus({preventScroll:true})
  const api=window.novelDesktop?.app
  const reveal=()=>{if(!nativeShown){nativeShown=true;last=0;emit('visualReady')}}
  if(api?.onWindowShown)stopShown=api.onWindowShown(reveal)
  else reveal()
  raf=requestAnimationFrame(tick)
  if(!reduced.value&&canvas.value){
    const element=canvas.value
    sceneTimeout=setTimeout(()=>{if(sceneState.value==='loading')sceneState.value='fallback'},12000)
    void import('./archive-scene').then(module=>module.ArchiveScene.create(element,failScene)).then(async result=>{
      if(disposed||reduced.value||(!browser&&sceneState.value==='fallback')){result.dispose();return}
      try{result.setProject(displaySelection.value);await result.prepare(dark.value)}catch(error){result.dispose();throw error}
      clearTimeout(sceneTimeout)
      if(disposed||reduced.value||(!browser&&sceneState.value==='fallback')){result.dispose();return}
      scene=result;sceneState.value='ready'
    }).catch(()=>{clearTimeout(sceneTimeout);if(!disposed)failScene()})
  }
})
onBeforeUnmount(()=>{document.removeEventListener('visibilitychange',updateVisibility);disposed=true;cancelAnimationFrame(raf);clearTimeout(sceneTimeout);stopShown?.();media?.removeEventListener('change',updateReduced);themeObserver?.disconnect();targetObserver?.disconnect();window.removeEventListener('resize',invalidateGeometry);window.removeEventListener('scroll',invalidateGeometry,true);releaseScene();if(arrival)arrival.concealed.value=false})
</script>

<template>
  <section ref="root" class="cinematic-boot app-boot" :class="{ 'motion-ready':visible, 'reduce-motion':reduced, 'is-entering':entering, 'dark-archive':dark }" :style="{opacity:bypass>=0?1-ease(progress(bypass,0,.45)):undefined}" role="dialog" aria-modal="true" aria-label="岚笺启动" tabindex="-1" data-testid="app-boot" :data-palette="palette" :data-boot-style="bootStyle" :data-boot-phase="phase" :data-cinematic-stage="entering?'handoff':stage" :data-scene-state="sceneState" :data-array-wait="arrayWait===null?undefined:arrayWait.toFixed(2)" :data-cinematic-time="seconds.toFixed(2)" @keydown.stop="keyboard">
    <div class="cinema-background" :data-handoff-time="handoff.toFixed(3)" :style="{opacity:backgroundOpacity}">
      <canvas ref="canvas" class="archive-canvas" :class="{revealed:seconds>=12&&sceneState==='ready'&&!reduced&&!sceneReleased}" aria-hidden="true" />
      <div class="cinema-grain" aria-hidden="true" />
      <div v-if="seconds>=1&&!reduced" class="cinema-frame" aria-hidden="true"><span class="brand-strip"><strong>LANJIAN.</strong><b>NARRATIVE SYSTEM</b></span><i>LOCAL / PERSONAL ARCHIVE</i><em v-if="stage==='array'||(stage==='extract'&&seconds<21.5)" :style="{opacity:stage==='extract'?1-progress(seconds,20.6,21.5):1}">{{stage==='array'?'SELECTING FILES…':'ARCHIVE LOCKED'}}</em></div>
      <aside v-if="seconds<25&&!reduced" class="archive-telemetry" :class="{'preparing-layout':seconds<12}" :aria-hidden="seconds<12" aria-label="本地档案状态">
        <span class="telemetry-heading">ARCHIVE / LOCAL SESSION</span>
        <div><i>01</i><code>projects.list()</code><b>{{ready||phase==='models'?`${projects.length} REGISTERED`:'READING'}}</b></div>
        <div><i>02</i><code>scene.prepare()</code><b>{{sceneState==='ready'?'ASSEMBLY READY':sceneState==='fallback'?'STATIC DISPLAY':'PREPARING'}}</b></div>
        <div><i>03</i><code>continue.select()</code><b>{{displaySelection?'BOUND':'EMPTY ARCHIVE'}}</b></div>
        <p>{{displaySelection?.title||'每一个世界，始于一页。'}}</p>
        <small>本地档案 · 只读投影<br>GLASS / ALLOY / NARRATIVE CORE</small>
      </aside>
      <div v-if="seconds>=27.4&&seconds<30.5&&!reduced" class="structure-labels" :style="{opacity:progress(seconds,27.4,27.9)*(1-progress(seconds,30,30.5))}" aria-hidden="true"><span>01 / OPTICAL GLASS<i/></span><span>02 / NARRATIVE CORE<i/></span><span>03 / ALLOY CHASSIS<i/></span></div>
      <div v-if="stage==='access'&&!reduced" class="access-frame" aria-hidden="true"><span>{{access}}</span><small>需要访问许可</small></div>
      <div v-if="(stage==='mark'||stage==='identity')&&!reduced" class="identity-frame" :class="{connected:stage==='identity'}" aria-hidden="true">
        <div class="identity-brand"><BrandMark drawing/><span>岚 笺</span><small>LANJIAN · NARRATIVE ARCHIVE</small></div>
        <div class="identity-copy"><i /><span>{{identity}}<b class="type-cursor" /></span><code>{{identityConnection}}</code><small>每一个世界，都值得被记住。</small></div>
      </div>
      <div v-if="stage==='scan'&&!reduced" class="scan-frame" aria-hidden="true">
        <div class="scan-crosshair"><i/><i/></div>
        <div class="scan-orbit" :style="{transform:`scale(${scanScale(seconds)})`,opacity:1-progress(seconds,8.55,9)}">
          <svg viewBox="0 0 1000 1000"><g :transform="`rotate(${(seconds-5)*68} 500 500)`"><circle cx="500" cy="500" r="450" class="orbit-thin"/><circle cx="500" cy="500" r="426" class="orbit-heavy" stroke-dasharray="920 210 500 1047"/><path d="M50 500h55M895 500h55M500 50v55M500 895v55" class="orbit-thin"/></g><g :transform="`rotate(${-(seconds-5)*23} 500 500)`"><path v-for="n in 96" :key="n" :d="`M500 ${n%8===0?102:112}v${n%8===0?22:8}`" :transform="`rotate(${n*3.75} 500 500)`" class="orbit-tick"/></g><circle cx="500" cy="500" r="365" class="orbit-dashed"/><circle cx="500" cy="500" r="322" class="orbit-thin"/></svg>
        </div>
        <div class="scan-core" :style="{opacity:progress(seconds,5.1,5.5)*(1-progress(seconds,8.55,9))}"><BrandMark/><span>LOCAL ACCESS</span><b>{{ready?'WORKSPACE READY':'CONNECTING'}}</b></div><p>正在接入创作档案</p><small>{{ready?'WORKSPACE CONNECTED':'ESTABLISHING CONNECTION'}}</small>
      </div>
      <div v-if="shutterVisible&&!reduced" class="transition-shutters" aria-hidden="true"><i v-for="band in 3" :key="band" :style="{transform:`translate3d(${shutterOffset(seconds,shutterStart,band-1)}%,0,0)`}"/></div>
      <div v-if="stage==='welcome'&&!reduced" class="welcome-frame" aria-hidden="true"><div class="welcome-rule"/><BrandMark/><span class="welcome-eyebrow">THE ARCHIVE IS YOURS.</span><h1>欢迎回来<span>创作者</span></h1><div class="welcome-bottom"><span>LANJIAN<br>NARRATIVE ARCHIVE</span><b>让想象，<br>拥有形状。</b><span>LOCAL WORKSPACE<br>ACCESS GRANTED</span></div></div>
      <div v-if="seconds<32.4&&!reduced" :key="seconds<20?'array':stage" class="scene-caption" :class="{'preparing-layout':seconds<12}" aria-hidden="true"><span>{{seconds<20?'01 / ARCHIVE FIELD':stage==='extract'?'02 / RETRIEVAL':'03 / MATERIAL STUDY'}}</span><h2>{{seconds<20?'世界，依次苏醒。':stage==='extract'?'有一个故事，正在等你。':'时间与想象的容器。'}}</h2><p>{{stage==='inspect'?'GLASS / LAMINATED CORE / MACHINED ALLOY':'LANJIAN / PERSONAL NARRATIVE COLLECTION'}}</p></div>
      <div v-if="seconds>=12&&seconds<32.4&&sceneState==='fallback'" class="fallback-mark" aria-hidden="true"><BrandMark/><span>LANJIAN / ARCHIVE</span></div>
      <div v-if="seconds>=32.4" class="arrival-heading" :class="{departing:entering}"><BrandMark/><span>YOUR NEXT CHAPTER AWAITS</span><p>{{displaySelection?'故事，仍在继续。':'每一个世界，始于一页。'}}</p></div>
      <footer v-if="seconds>=12||!reduced" class="scene-footer" :class="{'preparing-layout':seconds<12}" aria-hidden="true"><span>岚笺 / LANJIAN</span><i/><span>PRIVATE WORLDS. INFINITE POSSIBILITIES.</span></footer>
    </div>
    <div v-if="prepareFaces&&!error" ref="face" class="arrival-face" data-sound="none" :class="{'is-clicking':entering}" :style="faceStyle" :aria-hidden="!canEnter" :tabindex="!displaySelection&&canEnter?0:undefined" :role="!displaySelection?'button':undefined" :aria-label="!displaySelection?'进入我的作品':undefined" :inert="!canEnter" @click="!displaySelection&&enter()">
      <LibraryArchiveHero dossier-only :project="displaySelection" :project-count="projects.length" :loading="false" @open="enter" />
    </div>
    <div v-if="prepareFaces&&destinationLayout" class="landing-face" :style="landingStyle" aria-hidden="true" inert>
      <LibraryArchiveHero dossier-only :project="displaySelection" :project-count="projects.length" :loading="false" />
    </div>
    <div v-if="browser" class="browser-boot-controls"><button v-if="!soundActivated" @click="enableSound">开启声音 ♪</button><button v-if="ready&&!entering" @click="emit('complete')">直接进入 ↗</button></div>
    <button v-if="canEnter" class="enter-caption" data-testid="app-boot-enter" data-sound="none" @click="enter"><span>点击档案，进入我的作品</span><i>↗</i><small>CLICK TO ENTER · ENTER ↵</small></button>
    <div v-if="error" class="boot-status" :class="{'has-error':error}" role="status"><span>{{status}}</span><button v-if="error" @click="emit('retry')">重新尝试</button></div>
    <button v-if="preview" class="close-preview" @click="emit('skip')">动画预览 · 关闭 ×</button>
    <div class="live-load" :class="{'is-error':error}" data-testid="boot-live-load" role="status"><span class="load-code">{{ready?'READY':'LOCAL / LOADING'}}</span><span :key="status" class="load-black-block">{{status}}</span></div>
    <button v-if="canSkipArray" class="array-skip" data-testid="app-boot-skip-models" @click="skipModelsAndEnter">跳过加载，进入作品 <span>↗</span></button>
    <p class="sr-only" aria-live="polite">{{stageLabel}}</p>
  </section>
</template>

<style scoped>
.browser-boot-controls{position:absolute;right:24px;top:22px;z-index:9;display:flex;gap:12px}.browser-boot-controls button{font:11px var(--sans);padding:8px 14px;background:var(--cinema-paper);color:var(--cinema-ink);border:1px solid #7a826344;cursor:pointer}
.cinematic-boot{position:fixed;z-index:9000;inset:0;overflow:hidden;color:#222b27;outline:none;font-family:var(--sans);--cinema-paper:#e8e7e1;--cinema-ink:#222b27;--cinema-accent:#9b8758}
.cinema-background{position:absolute;inset:0;background:var(--cinema-paper);color:var(--cinema-ink);overflow:hidden;will-change:opacity}.dark-archive{--cinema-paper:#17241e;--cinema-ink:#e3e6d9;color:var(--cinema-ink)}
.archive-canvas{position:absolute;inset:0;inline-size:100%;block-size:100%;opacity:0;transition:opacity 1s;pointer-events:none}.archive-canvas.revealed{opacity:1}
.cinema-grain{position:absolute;inset:0;pointer-events:none;opacity:.2;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.92' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%237c776d' filter='url(%23n)' opacity='.2' d='M0 0h180v180H0z'/%3E%3C/svg%3E")}
.access-frame{position:absolute;inset:0;display:grid;place-content:center;text-align:center}.access-frame>span{font-size:clamp(9px,.78vw,13px);font-weight:500;letter-spacing:-.025em;min-height:1em}.access-frame>small{position:absolute;bottom:3%;left:0;right:0;font-size:10px;color:#666a63}
.identity-frame{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:0}.identity-brand{display:flex;align-items:center;flex-direction:column;width:260px;transition:transform 1.5s cubic-bezier(.2,.7,.15,1)}.identity-brand>.lanjian-mark{width:132px;height:132px}.identity-brand>span{margin-top:28px;font:500 31px var(--serif);letter-spacing:.45em;padding-left:.45em}.identity-brand>small{font-size:8px;letter-spacing:.25em;margin-top:20px;color:#777e73}.identity-copy{position:absolute;left:calc(50% + 35px);width:min(32vw,460px);display:flex;flex-direction:column;gap:24px;opacity:0;transform:translateX(35px);transition:opacity .8s,transform 1.5s}.connected .identity-brand{transform:translateX(-180px)}.connected .identity-copy{opacity:1;transform:none}.identity-copy>i{width:32px;height:1px;background:#747d71}.identity-copy>span{font-size:clamp(10px,1.15vw,18px);letter-spacing:.1em;white-space:nowrap}.identity-copy>small{font:12px var(--serif);letter-spacing:.18em;color:#6f776d}.type-cursor{display:inline-block;width:2px;height:1em;background:currentColor;vertical-align:middle;margin-left:5px;animation:cursor-blink .7s steps(1) infinite}
.scan-frame{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column}.scan-orbit{width:min(34vw,320px);aspect-ratio:1;position:relative;display:grid;place-items:center;animation:ring-arrive 1.5s cubic-bezier(.18,.7,.18,1) both}.scan-orbit>i{position:absolute;inset:0;border:1px solid #6c756547;border-radius:50%;border-top-color:#303f31;border-right-color:#303f31;animation:orbit 4s linear infinite}.scan-orbit>i:nth-child(2){inset:12px;border-style:dashed;animation:orbit 12s linear reverse infinite;opacity:.45}.scan-orbit>i:nth-child(3){inset:30px;border:none;border-top:2px solid #9b8758;animation:orbit 2.7s linear infinite}.scan-orbit>span{font-size:10px;line-height:2;letter-spacing:.5em;text-align:center;padding-left:.5em}.scan-frame>p{font:15px var(--serif);letter-spacing:.35em;margin-top:35px}.scan-frame>small{font-size:8px;letter-spacing:.22em;color:#78806f}
.welcome-frame{position:absolute;inset:0;padding:9vh 10vw;display:flex;flex-direction:column;justify-content:center;animation:welcome-cuts 1s steps(1) both,welcome-exit .85s 3.2s cubic-bezier(.4,0,.2,1) both}.welcome-frame>.lanjian-mark{width:80px;height:80px;position:absolute;top:10vh;right:10vw}.welcome-rule{height:1px;width:100%;background:#65715c66;position:absolute;left:10vw;top:25vh;width:80vw;transform-origin:left;animation:rule-reveal 1.2s .5s both}.welcome-eyebrow{font-size:10px;letter-spacing:.4em;margin-top:6vh}.welcome-frame h1{font:400 clamp(50px,8vw,132px)/1.2 var(--serif);letter-spacing:.08em;margin:22px 0 6vh}.welcome-frame h1>span{display:block;font-size:.4em;margin:14px 0 0 35%;letter-spacing:.5em}.welcome-bottom{display:flex;align-items:end;justify-content:space-between;border-top:1px solid #65715c66;padding-top:20px}.welcome-bottom>span{font-size:8px;line-height:1.7;letter-spacing:.18em}.welcome-bottom>b{font:400 17px/1.5 var(--serif);letter-spacing:.2em}
.scene-caption{position:absolute;top:10%;left:6%;pointer-events:none;color:var(--cinema-ink);text-shadow:0 1px 20px var(--cinema-paper)}.scene-caption>span{font-size:9px;letter-spacing:.22em}.scene-caption>h2{font:400 clamp(22px,3vw,42px) var(--serif);letter-spacing:.12em;margin:18px 0}.scene-caption>p{font-size:8px;letter-spacing:.2em}.scene-footer{position:absolute;bottom:30px;left:4%;right:4%;display:flex;gap:25px;align-items:center;font-size:8px;letter-spacing:.17em;opacity:.65}.scene-footer>i{flex:1;height:1px;background:currentColor;opacity:.2}
.arrival-heading{position:absolute;top:5%;left:0;right:0;display:flex;align-items:center;flex-direction:column;transition:opacity .25s}.arrival-heading>.lanjian-mark{width:38px;height:38px}.arrival-heading>span{font-size:8px;letter-spacing:.3em;margin-top:14px}.arrival-heading>p{font:400 20px var(--serif);letter-spacing:.2em;margin:10px 0}.arrival-heading.departing{opacity:0}
.arrival-face,.landing-face{position:absolute;z-index:2;container:library-content / size;transform-origin:0 0;outline:none;will-change:transform,opacity;box-shadow:0 25px 30px #15241b25}.landing-face{z-index:3;pointer-events:none;will-change:transform,opacity,clip-path}.arrival-face:focus-visible{outline:2px solid var(--cinema-accent);outline-offset:6px}.arrival-face.is-clicking:after{content:'';position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,#e7ffeb55 48%,transparent 61%);pointer-events:none;animation:click-shimmer .65s ease-out both}
.glass-inscription{position:absolute;z-index:1;inset:8% 9% auto;pointer-events:none;color:#233c30}.glass-inscription>span{font-size:8px;letter-spacing:.15em}.glass-inscription>h2{font:500 clamp(18px,4cqi,30px)/1.3 var(--serif);margin:12px 0;max-width:90%;overflow-wrap:anywhere}.glass-inscription>small{font-size:6px;letter-spacing:.13em;opacity:.6}
.arrival-face:has(:focus-visible){outline:1px solid #9b875877;outline-offset:5px}
.enter-caption{position:absolute;z-index:3;bottom:8%;left:50%;transform:translateX(-50%);border:0;background:none;color:var(--cinema-ink);padding:14px 24px;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:12px 20px;text-align:left}.enter-caption>span{font:14px var(--serif);letter-spacing:.15em}.enter-caption>i{font-style:normal}.enter-caption>small{grid-column:1/-1;font-size:8px;letter-spacing:.24em;opacity:.6}.enter-caption:hover{background:#8a967214}.enter-caption:focus-visible,.close-preview:focus-visible,.boot-status button:focus-visible{outline:2px solid #987b44;outline-offset:4px}
.boot-status{position:absolute;z-index:5;bottom:9%;left:50%;transform:translateX(-50%);max-width:80%;display:flex;align-items:center;justify-content:center;gap:20px;font-size:12px;background:var(--cinema-paper);padding:14px 20px;border:1px solid #86917b44}.boot-status.has-error{color:#85462d}.boot-status button{cursor:pointer;padding:8px 12px;border:1px solid currentColor;background:none;color:inherit;white-space:nowrap}.close-preview{position:absolute;right:24px;top:22px;z-index:8;font-size:11px;letter-spacing:.1em;padding:8px 14px;background:var(--cinema-paper);color:var(--cinema-ink);border:1px solid #7a826344;cursor:pointer}.fallback-mark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:25px}.fallback-mark>.lanjian-mark{width:180px;height:180px}.fallback-mark>span{font-size:9px;letter-spacing:.3em}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@keyframes cursor-blink{50%{opacity:0}}@keyframes orbit{to{transform:rotate(360deg)}}@keyframes ring-arrive{from{transform:scale(3);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes rule-reveal{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes welcome-cuts{0%{background:#1d2b23;color:#f0f1e6;clip-path:inset(45% 0 45% 0)}12%{background:#e8e7e1;color:#222b27;clip-path:inset(0)}38%{background:#1d2b23;color:#f0f1e6}60%,100%{background:#e8e7e1;color:#222b27}}@keyframes welcome-exit{to{opacity:0;transform:scale(.8);filter:blur(5px)}}@keyframes click-shimmer{from{transform:translateX(-70%);opacity:0}20%{opacity:1}to{transform:translateX(70%);opacity:0}}
.cinematic-boot:not(.motion-ready) *{animation-play-state:paused!important}.reduce-motion *{animation:none!important;transition:none!important}
@media(max-width:750px){.connected .identity-brand{transform:translate(-100px,-40px) scale(.75)}.identity-copy{left:48%;width:48%}.identity-copy>span{font-size:9px}.identity-copy>small{font-size:10px}.arrival-heading>p{font-size:16px}.scene-caption{top:7%}.scene-footer>span:last-child{display:none}.enter-caption{bottom:5%}}
@media(max-height:700px){.arrival-heading{top:4%;flex-direction:row;justify-content:center;gap:16px}.arrival-heading>.lanjian-mark{width:28px;height:28px}.arrival-heading>span{margin:0;font-size:7px}.arrival-heading>p{margin:0;font-size:15px}.scene-footer{bottom:16px}}

.cinematic-boot{--cinema-paper:#ebeae3;--cinema-ink:#1d2923;--cinema-accent:#9b8052}.dark-archive{--cinema-paper:#101917;--cinema-ink:#e5eee6;--cinema-accent:#89cbb4}
.cinema-frame{position:absolute;z-index:1;inset:28px 32px;border:1px solid color-mix(in srgb,var(--cinema-ink) 18%,transparent);pointer-events:none}.cinema-frame>.brand-strip{position:absolute;top:24px;left:24px;display:grid;gap:4px;font-size:12px;letter-spacing:.08em}.brand-strip strong{display:block;width:max-content;font:800 24px/.96 var(--sans);letter-spacing:-.045em;background:var(--cinema-ink);color:var(--cinema-paper);padding:4px 9px;animation:block-in .48s cubic-bezier(.2,.8,.15,1) both}.brand-strip b{font-size:8px;font-weight:500;letter-spacing:.2em;animation:block-in .6s .12s both}.cinema-frame>i{position:absolute;right:20px;bottom:16px;font:8px monospace;letter-spacing:.13em;opacity:.6}.cinema-frame>em{position:absolute;left:53%;top:45%;font:600 11px var(--sans);font-style:normal;letter-spacing:.08em}.cinema-frame>em:not(:empty):after{content:'';display:block;margin-top:16px;width:35vw;height:1px;background:currentColor;opacity:.2}
.identity-brand>.lanjian-mark{width:150px;height:150px}.identity-brand{transition:transform .8s cubic-bezier(.2,.8,.15,1)}.identity-copy{transition:opacity .4s,transform .8s}.identity-brand>span{font:700 24px var(--sans);letter-spacing:.55em;margin-top:18px}.identity-brand>small,.identity-copy>small{color:var(--cinema-ink);opacity:.6}.identity-copy>i{background:var(--cinema-accent)}
.scan-orbit{width:min(88vmin,760px);aspect-ratio:1;animation:none;will-change:transform}.scan-orbit>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;fill:none;stroke:var(--cinema-ink)}.orbit-thin{stroke-width:.75;opacity:.4}.orbit-heavy{stroke-width:3;opacity:.95}.orbit-tick{stroke-width:1.6;opacity:.6}.orbit-dashed{stroke:var(--cinema-accent);stroke-width:1;stroke-dasharray:2 13;opacity:.85}.scan-core{display:grid;justify-items:center;gap:16px}.scan-core>.lanjian-mark{width:50px;height:50px}.scan-core>span{font:500 11px var(--sans);letter-spacing:.5em}.scan-core>b{font:8px monospace;letter-spacing:.25em;color:var(--cinema-accent)}.scan-frame>p{position:absolute;bottom:7%;margin:0;font:14px var(--serif)}.scan-frame>small{position:absolute;bottom:4%;color:var(--cinema-ink);opacity:.55}.scan-crosshair{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.scan-crosshair i{position:absolute;width:100%;height:1px;background:linear-gradient(90deg,transparent,var(--cinema-ink),transparent);opacity:.1}.scan-crosshair i+i{transform:rotate(90deg)}
.scan-light-slit{position:absolute;z-index:5;inset:49.85% 0;background:var(--cinema-ink);box-shadow:0 0 60px var(--cinema-accent);animation:slit-cut .75s cubic-bezier(.65,0,.2,1) both}
.welcome-frame{animation:welcome-cuts .65s steps(1) both,welcome-exit .65s 2.35s cubic-bezier(.4,0,.2,1) both}.welcome-frame h1{width:max-content;max-width:100%;position:relative;animation:block-in .7s .15s both}.welcome-frame h1:after{content:'';position:absolute;inset:-4px -24px;background:var(--cinema-ink);transform-origin:right;animation:word-shutter 1s .2s both}.welcome-eyebrow{animation:block-in .65s .35s both}.welcome-rule{animation:rule-reveal .7s .25s both}.welcome-bottom{animation:block-in .6s .5s both}
.scene-caption{top:auto;bottom:10%;left:6%}.scene-caption>h2{font-size:clamp(18px,2.1vw,30px);margin:12px 0}.scene-caption>p{opacity:.65}.scene-footer{bottom:65px;left:56px;right:56px;font-size:7px}.structure-labels{position:absolute;right:9%;top:35%;display:grid;gap:70px;pointer-events:none;animation:block-in .6s both}.structure-labels>span{position:relative;font:9px monospace;letter-spacing:.13em;background:var(--cinema-paper);padding:8px 12px;border-left:2px solid var(--cinema-accent)}.structure-labels i{position:absolute;right:100%;top:50%;width:8vw;height:1px;background:var(--cinema-accent);opacity:.5}
.live-load{position:absolute;z-index:6;left:56px;bottom:16px;display:flex;align-items:center;gap:12px;max-width:calc(100% - 112px);font:10px var(--sans);pointer-events:none}.load-code{font:8px monospace;letter-spacing:.12em;opacity:.6;white-space:nowrap}.load-black-block{position:relative;display:block;overflow:hidden;background:var(--cinema-ink);color:var(--cinema-paper);padding:5px 10px;max-width:70vw;text-overflow:ellipsis;white-space:nowrap;animation:block-in .4s cubic-bezier(.16,.8,.16,1) both}.load-black-block:after{content:'';position:absolute;inset:0;background:var(--cinema-ink);transform-origin:right;animation:word-shutter .55s .15s both}.live-load.is-error .load-black-block{background:#a74e34;color:#fff}.arrival-heading{top:10%}.arrival-heading>.lanjian-mark{width:32px;height:32px}.arrival-heading>span{margin-top:8px}.enter-caption{bottom:10%}
@keyframes block-in{from{clip-path:inset(0 100% 0 0);transform:translateX(-12px)}to{clip-path:inset(0);transform:none}}@keyframes word-shutter{0%,30%{transform:scaleX(1)}100%{transform:scaleX(0)}}@keyframes slit-cut{0%{transform:scaleX(0)}35%{transform:scaleX(1)}60%{transform:scaleY(1)}100%{transform:scaleY(700);opacity:0}}@keyframes welcome-cuts{0%{background:var(--cinema-ink);color:var(--cinema-paper);clip-path:inset(48% 0)}15%{background:var(--cinema-paper);color:var(--cinema-ink);clip-path:inset(0)}35%{clip-path:inset(0 45% 0 0)}55%,100%{background:var(--cinema-paper);color:var(--cinema-ink);clip-path:inset(0)}}
@media(max-height:700px){.arrival-heading{top:10%}.cinema-frame{inset:18px 22px}.scene-caption{bottom:12%}.enter-caption{bottom:7%}.scene-footer{display:none}}
.reduce-motion .cinema-frame{display:none}.reduce-motion .live-load{bottom:24px}.reduce-motion *{animation:none!important;transition:none!important}

.array-skip{position:absolute;z-index:7;right:4%;bottom:24px;cursor:pointer;border:1px solid color-mix(in srgb,var(--cinema-ink) 40%,transparent);background:var(--cinema-paper);color:var(--cinema-ink);font:12px var(--sans);padding:12px 18px;display:flex;gap:24px}.array-skip:focus-visible{outline:2px solid var(--cinema-accent);outline-offset:4px}
.archive-telemetry{position:absolute;right:6%;top:17%;width:250px;pointer-events:none;font:9px/1.8 monospace;color:var(--cinema-ink);border-top:1px solid color-mix(in srgb,var(--cinema-ink) 35%,transparent);padding-top:15px;text-shadow:0 0 12px var(--cinema-paper)}.telemetry-heading{display:block;font-size:8px;letter-spacing:.2em;margin-bottom:18px;opacity:.55}.archive-telemetry>div{display:grid;grid-template-columns:20px 1fr;gap:0 8px;padding:7px 0;border-bottom:1px solid color-mix(in srgb,var(--cinema-ink) 12%,transparent);animation:block-in .6s both}.archive-telemetry>div:nth-of-type(2){animation-delay:.2s}.archive-telemetry>div:nth-of-type(3){animation-delay:.4s}.archive-telemetry i{grid-row:span 2;font-style:normal;opacity:.4;font-size:8px}.archive-telemetry code{font:inherit}.archive-telemetry b{grid-column:2;font:7px monospace;letter-spacing:.12em;opacity:.65}.archive-telemetry p{font:600 15px/1.5 var(--serif);overflow-wrap:anywhere;max-height:3em;overflow:hidden}.archive-telemetry small{font:7px/1.8 monospace;letter-spacing:.1em;opacity:.55}@media(max-width:1000px){.archive-telemetry{right:6%;top:18%;width:185px;font-size:8px}.archive-telemetry p{font-size:12px}}

/* Pre-layout the first archive labels; retain their initial animation pose until reveal. */
.preparing-layout{visibility:hidden;pointer-events:none}
.preparing-layout,.preparing-layout *,.preparing-layout:before,.preparing-layout:after,.preparing-layout *:before,.preparing-layout *:after{animation-play-state:paused!important}

/* Continuous choreography: text holds still while the optical rings converge. */
.identity-copy>code{font:9px/1.5 monospace;letter-spacing:.15em;min-height:1.5em;opacity:.6}
.scan-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.scan-orbit>svg{contain:paint}
.transition-shutters{position:absolute;z-index:6;inset:0;display:grid;grid-template-rows:repeat(3,1fr);pointer-events:none;overflow:hidden}
.transition-shutters>i{display:block;background:var(--cinema-ink);will-change:transform;border-top:1px solid color-mix(in srgb,var(--cinema-paper) 14%,transparent)}
.transition-shutters>i:nth-child(2){background:color-mix(in srgb,var(--cinema-ink) 94%,var(--cinema-accent))}
.welcome-frame{animation:welcome-arrive .6s both,welcome-depart .55s 2.55s both}
.welcome-frame h1{animation:welcome-type .8s .15s cubic-bezier(.16,.8,.16,1) both}
.welcome-frame h1:after{inset:0 -16px;animation:word-shutter .85s .15s both}
.welcome-bottom{animation:welcome-type .7s .4s both}
.scene-caption{animation:caption-arrive .7s cubic-bezier(.16,.8,.16,1) both}
.scene-caption>span{display:block;color:var(--cinema-accent)}
.scene-caption>h2{animation:caption-arrive .9s .08s both}
.archive-telemetry>div{position:relative;overflow:hidden}
.archive-telemetry b{justify-self:start;margin:4px 0 2px;padding:3px 6px;background:var(--cinema-ink);color:var(--cinema-paper);opacity:1}
.archive-telemetry>div:after{content:'';position:absolute;inset:0;background:var(--cinema-ink);transform-origin:right;animation:word-shutter .7s both}
.archive-telemetry>div:nth-of-type(2):after{animation-delay:.16s}
.archive-telemetry>div:nth-of-type(3):after{animation-delay:.32s}
.structure-labels>span{animation:caption-arrive .6s both}
.structure-labels>span:nth-child(2){animation-delay:.12s}
.structure-labels>span:nth-child(3){animation-delay:.24s}
.structure-labels i{transform-origin:right;animation:rule-reveal .7s .15s both}
.arrival-heading{animation:caption-arrive .7s both}
.enter-caption{animation:entry-invitation .65s both}
.enter-caption>i{transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.enter-caption:hover>i{transform:translate(3px,-3px)}
.enter-caption:after{content:'';position:absolute;bottom:0;left:24px;right:24px;height:1px;background:var(--cinema-accent);transform:scaleX(.25);transform-origin:left;transition:transform .3s}
.enter-caption:hover:after,.enter-caption:focus-visible:after{transform:scaleX(1)}
@keyframes welcome-arrive{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
@keyframes welcome-depart{to{opacity:0;transform:translateX(-36px)}}
@keyframes welcome-type{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes caption-arrive{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes entry-invitation{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}

</style>

<style scoped src="../../../assets/loading-colors.css"></style>
