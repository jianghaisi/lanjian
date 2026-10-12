import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import * as Timeline from '../../../src/renderer/app/components/boot/cinematic-timeline'
import { selectContinueProject } from '../../../src/renderer/features/library/composables/continue-project'
import { dossierArrivalKey } from '../../../src/renderer/features/library/composables/dossier-arrival'
import { useBootSounds } from '../../../src/renderer/app/composables/useBootSounds'
import { useUiSounds } from '../../../src/renderer/app/composables/useUiSounds'

async function render(props: Record<string, unknown>) {
  const source=await readFile(new URL('../../../src/renderer/app/components/boot/CinematicBoot.vue',import.meta.url),'utf8')
  const {descriptor}=parse(source)
  let code=compileScript(descriptor,{id:'cinematic-spec',inlineTemplate:true}).content
    .replace(/import\s*\{\s*useBootSounds\s*\}\s*from\s*['"][^'"]+['"];?/, '')
    .replace(/import\s*\{\s*useUiSounds\s*\}\s*from\s*['"][^'"]+['"];?/, '')
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,(_,names:string)=>`const { ${names.replace(/\s+as\s+/g,': ')} } = Vue;`)
    .replace(/import BrandMark from ['"][^'"]+['"];?/, 'const BrandMark = { render: () => Vue.h("svg") };')
    .replace(/import LibraryArchiveHero from ['"][^'"]+['"];?/, 'const LibraryArchiveHero = { render: () => null };')
    .replace(/import\s*\{\s*selectContinueProject\s*\}\s*from\s*['"][^'"]+['"];?/, '')
    .replace(/import\s*\{\s*dossierArrivalKey\s*\}\s*from\s*['"][^'"]+['"];?/, '')
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/cinematic-timeline['"];?/, (_,names:string)=>`const {${names.replace(/,?\s*type\s+\w+/g,'')}} = Timeline;`)
  const compiled=await transformWithEsbuild(code,'cinematic-spec.ts',{loader:'ts'})
  const viewport={innerWidth:1440,innerHeight:960,devicePixelRatio:1,matchMedia:()=>({matches:false})}
  const component=new Function('Vue','Timeline','selectContinueProject','dossierArrivalKey','useBootSounds','useUiSounds','window',compiled.code.replace('export default','return'))(Vue,Timeline,selectContinueProject,dossierArrivalKey,useBootSounds,useUiSounds,viewport)
  return renderToString(Vue.createSSRApp(component,props))
}

test('startup error preserves escaped recovery text and never renders a false ready entry',async()=>{
  const html=await render({phase:'projects',error:'作品索引 <不可读>'})
  assert.match(html,/作品索引 &lt;不可读&gt;/)
  assert.match(html,/重新尝试/)
  assert.doesNotMatch(html,/data-testid="app-boot-enter"/)
  assert.match(html,/aria-modal="true"/)
})
test('visual preview is explicitly identified and offers its own close action',async()=>{
  const html=await render({phase:'editor',preview:true})
  assert.match(html,/动画预览 · 关闭/)
  assert.doesNotMatch(html,/模型未能|重新尝试/)
})
test('core initialization cannot be bypassed by reduced motion; model skip stays scoped',async()=>{
  const html=await render({phase:'models',reducedMotion:true,canSkipModels:true,detail:'模型正在准备'})
  assert.match(html,/正在接入本地模型/)
  assert.match(html,/跳过加载，进入作品/);assert.doesNotMatch(html,/class="boot-status/);assert.doesNotMatch(html,/首次加载|请稍候|暂不等待模型/)
  assert.doesNotMatch(html,/data-testid="app-boot-enter"/)
})

test('normal opener withholds model skip until the first archive pass; core phases never offer it',async()=>{
  const preparing=await render({phase:'models',canSkipModels:true})
  assert.doesNotMatch(preparing,/data-testid="app-boot-skip-models"/)
  const core=await render({phase:'projects',canSkipModels:true,reducedMotion:true})
  assert.doesNotMatch(core,/data-testid="app-boot-skip-models"/)
  const failed=await render({phase:'models',canSkipModels:true,reducedMotion:true,error:'模型准备失败'})
  assert.match(failed,/重新尝试/);assert.match(failed,/跳过加载，进入作品/)
})
