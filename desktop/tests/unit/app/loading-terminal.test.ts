import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as BootCompletion from '../../../src/renderer/app/composables/use-boot-completion'
import { useWorkspaceLoadingSounds } from '../../../src/renderer/app/composables/useWorkspaceLoadingSounds'

function componentUrl(name: string): URL {
  const paths: Record<string, string> = {
    'AppBootScreen.vue': '../../../src/renderer/app/components/AppBootScreen.vue',
    'ImpactBoot.vue': '../../../src/renderer/app/components/boot/ImpactBoot.vue',
    'WorkspaceLoadingScreen.vue': '../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue'
  }
  const path = paths[name]
  if (!path) throw new Error('Unknown loader fixture: ' + name)
  return new URL(path, import.meta.url)
}

async function loadComponent(url: URL): Promise<Vue.Component> {
  const relative = url.pathname
  const source = await readFile(url, 'utf8')
  const { descriptor } = parse(source)
  const dependencies: Record<string, Vue.Component> = {}
  let code: string
  if (descriptor.scriptSetup) {
    code = compileScript(descriptor, { id: relative, inlineTemplate: true }).content
    const imports = [...code.matchAll(/import (\w+) from ['"]([^'"]+\.vue)['"];?/g)]
    for (const [, name, path] of imports) {
      dependencies[name!] = await loadComponent(new URL(path!, url))
      code = code.replace(new RegExp(`import ${name} from ['"][^'"]+['"];?`), `const ${name} = dependencies.${name};`)
    }
  } else {
    const result = compileTemplate({ source: descriptor.template!.content, filename: relative, id: relative })
    assert.deepEqual(result.errors, [])
    code = result.code.replace('export function render', 'function render') + '\nexport default { render };'
  }
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
    (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"](?:\.\.\/){1,2}composables\/use-boot-completion['"];?/g,
    (_, names: string) => `const { ${names} } = BootCompletion;`)
  const compiled = await transformWithEsbuild(code, relative + '.ts', { loader: 'ts' })
  const evaluated = compiled.code.replace(/import\s*\{\s*useWorkspaceLoadingSounds\s*\}\s*from\s*['"][^'"]+['"];?/, '')
  return new Function('Vue', 'dependencies', 'BootCompletion', 'useWorkspaceLoadingSounds', evaluated.replace('export default', 'return'))(Vue, dependencies, BootCompletion, useWorkspaceLoadingSounds)
}

const render = async (name: string, props: Record<string, unknown>) => renderToString(Vue.createSSRApp(await loadComponent(componentUrl(name)), props))

test('restored impact startup keeps true model readiness, quiet skip and independent preview', async () => {
  const waiting=await render('ImpactBoot.vue',{phase:'models',modelsRequired:true,canSkipModels:true,detail:'首次加载可能需要较长时间，请稍候。'})
  assert.match(waiting,/data-boot-style="impact"/)
  assert.match(waiting,/正在接入已启用的本地模型/)
  assert.match(waiting,/data-testid="app-boot-skip-models"/)
  assert.doesNotMatch(waiting,/首次加载|请稍候|SYSTEM READY/)
  const preview=await render('ImpactBoot.vue',{phase:'editor',preview:true})
  assert.match(preview,/动画预览 · 非真实载入/)
  assert.match(preview,/data-testid="app-boot-skip"/)
  const error=await render('ImpactBoot.vue',{phase:'projects',error:'索引 <读取失败>'})
  assert.match(error,/索引 &lt;读取失败&gt;/)
  assert.match(error,/data-testid="app-boot-retry"/)
})

test('archive loader projects real phases and keeps cancellation available before slow state', async () => {
  const html = await render('WorkspaceLoadingScreen.vue', { title: '测试作品 · 第一部', phase: 'chapter', slow: false })
  assert.match(html, /测试作品 · 第一部/)
  assert.match(html, /data-loading-phase="chapter"/)
  assert.match(html, /data-testid="cancel-workspace-loading"/)
  assert.match(html, /阶段 4 \/ 6/)
  assert.match(html, /data-loader-progress="67"/)
  assert.match(html, /data-testid="workspace-progress-line"/)
  assert.match(html, /data-testid="workspace-title-watermark"[^>]*><span>测试作品·<\/span>/)
  assert.equal((html.match(/<li class="complete"/g) ?? []).length, 3)
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1)
  assert.match(html, /SELECTED DOSSIER/)
  assert.match(html, /data-loader-theme="impact"/)
  assert.doesNotMatch(html, /原创角色占位|CompanionIllustration/)
  assert.doesNotMatch(html, /这部作品需要多一点时间|SQLite|ONLINE/)
})

test('workspace title watermark keeps five visible characters on one line without an ellipsis', async () => {
  const html = await render('WorkspaceLoadingScreen.vue', { title: ' 超长 作品名称验证 ', phase: 'chapter', slow: false })
  assert.match(html, /data-testid="workspace-title-watermark"[^>]*><span>超长作品名<\/span>/)
  assert.doesNotMatch(html.match(/data-testid="workspace-title-watermark"[^>]*><span>([^<]*)<\/span>/)?.[1] ?? '', /…/)
  const source = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.match(source, /slice\(0, 5\)/)
  assert.match(source, /white-space:nowrap/)
  assert.match(source, /<main class="archive-progress">[\s\S]*<div class="archive-watermark"/)
  assert.doesNotMatch(source, /archive-progress-heading/)
  assert.match(source, /archive-watermark\{position:absolute;z-index:0;inset:auto 0 0;/)
  assert.match(source, /archive-progress>:not\(\.archive-watermark\)\{position:relative;z-index:1\}/)
  assert.match(source, /font:900 clamp\(42px,11cqw,96px\)/)
})

test('workspace progress line retains its completed range and one-second completion', async () => {
  const work = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'workspace', slow: false })
  const workReady = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'ready', slow: false })
  for (const html of [work]) {
    assert.match(html, /data-loader-progress="50"/)
  }
  assert.match(workReady, /data-loader-progress="100"/)

  for (const name of ['WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.match(source, /LINE_START_PERCENT = 5/)
    assert.match(source, /line\.getBoundingClientRect\(\)/)
    assert.match(source, /line\.style\.transitionDuration = '0ms'/)
    assert.match(source, /line\.style\.left = `\$\{currentLeft\}px`/)
    assert.match(source, /transition-property:left,opacity/)
    assert.match(source, /transition-timing-function:linear/)
    assert.match(source, /@transitionend="continueProgressPatrol"/)
  }
  const workspaceSource = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.equal(BootCompletion.BOOT_COMPLETION_DURATION_MS, 3000)
  assert.match(workspaceSource, /LINE_COMPLETION_DURATION_MS = 1000/)
})

test('workspace completion maps the dossier block onto the real writing sidebar geometry', async () => {
  const source = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  const appShell = (await Promise.all(['app/AppShell.vue', 'app/use-workspace-controller.js', 'features/library/composables/create-opening-actions.js', 'features/library/composables/create-projects-actions.js'].map(path => readFile(new URL('../../../src/renderer/' + path, import.meta.url), 'utf8')))).join('\n')
  const desktopCss = await readFile(new URL('../../../src/renderer/assets/desktop.css', import.meta.url), 'utf8')
  assert.match(source, /archive-to-sidebar 1s/)
  assert.match(source, /72 \+ props\.sidebarWidth/)
  assert.match(source, /window\.innerHeight - targetTop - 24/)
  assert.equal(BootCompletion.BOOT_COMPLETION_DURATION_MS, 3000)
  assert.match(appShell, /WORKSPACE_COMPLETION_DURATION_MS = 1000/)
  assert.match(appShell, /WORKSPACE_PHASE_DWELL_MS = 320/)
  assert.match(appShell, /WORKSPACE_PHASE_SEQUENCE = \['switch', 'database', 'workspace', 'chapter', 'recovery', 'ready'\]/)
  assert.match(appShell, /targetPhase: 'switch'/)
  assert.match(appShell, /beginWorkspaceOpening\(project, \{ replay = true, visible = true \} = \{\}\)/)
  assert.doesNotMatch(appShell, /workspaceOpeningShowTimer/)
  assert.match(appShell, /advanceWorkspaceOpeningPhase\(\)/)
  assert.match(appShell, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{/)
  assert.match(appShell, /await (?:ports\.)?waitForWorkspaceOpeningPhase\(generation, 'ready'\)/)
  assert.match(source, /archive-phase-enter \.16s ease-out both/)
  assert.doesNotMatch(source, /@keyframes archive-phase-enter\{[^}]*translate/)
  assert.match(desktopCss, /\.workspace-loading-fade-enter-active\s*\{\s*transition: none;/)
  assert.match(appShell, /:sidebar-width="explorerWidth"/)
})

test('both existing workspace themes render archive phases without demo book data or synthetic percent', async () => {
  for (const theme of ['standard', 'impact']) {
    const work = await render('WorkspaceLoadingScreen.vue', { title: '作者传入的当前作品', phase: 'workspace', slow: false, theme, preview: true })
    for (const html of [work]) {
      assert.match(html, new RegExp(`data-loader-theme="${theme}"`))
      assert.doesNotMatch(html, /124,806|第十七章断点|AI COPILOT|SYSTEM ONLINE|\d+%<\/strong>/)
    }
    assert.match(work, /动画预览 · 非真实载入/)
    assert.match(work, /关闭预览/)
    assert.match(work, /作者传入的当前作品/)
    assert.match(work, theme === 'impact' ? /UNSEAL/ : /OPEN/)
  }
})

test('repeat workspace entry retains real progress with quick motion and cancellation', async () => {
  const html = await render('WorkspaceLoadingScreen.vue', { title: '已打开作品', phase: 'chapter', slow: false, quick: true })
  assert.match(html, /data-loading-quick="true"/)
  assert.match(html, /quick-entry/)
  assert.match(html, /data-loading-phase="chapter"/)
  assert.match(html, /data-testid="cancel-workspace-loading"/)
  const source = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.match(source, /props\.quick \? 160/)
  assert.match(source, /animation-duration:\.16s!important;animation-delay:0s!important/)
})

test('workspace loader derives its palette from all three app themes independently of motion style', async () => {
  for (const name of ['WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.match(source, /data-theme="xuanzhi"/)
    assert.match(source, /data-theme="moye"/)
    assert.match(source, /var\(--color-orange/)
  }
  const workspace = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.match(workspace, /--loader-canvas:var\(--color-paper/)
  assert.match(workspace, /--loader-dossier:#29251f/)
  assert.match(workspace, /--loader-dossier:#101513/)
})

test('archive errors retain escape/return and explicit retry without a false complete state', async () => {
  const html = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'ready', slow: false, error: '读取失败', theme: 'impact' })
  assert.match(html, /data-testid="workspace-loading-retry"/)
  assert.match(html, /data-testid="cancel-workspace-loading"/)
  assert.match(html, /读取失败/)
  assert.equal((html.match(/已完成/g) ?? []).length, 5)
})

test('slow archive load keeps return access without a warning banner or false completion', async () => {
  const loading = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'workspace', slow: true })
  assert.match(loading, /data-testid="cancel-workspace-loading"/)
  assert.match(loading, /进行中/)
  assert.doesNotMatch(loading, /archive-slow|这部作品需要多一点时间|大型作品首次读取/)
  const html = await render('WorkspaceLoadingScreen.vue', { title: '<script>private()</script>', phase: 'ready', slow: true })
  assert.match(html, /&lt;script&gt;/)
  assert.equal((html.match(/已完成/g) ?? []).length, 6)
  assert.doesNotMatch(html, /archive-slow|这部作品需要多一点时间/)
  assert.doesNotMatch(html, /<script>private|进行中/)
})

test('workspace loading remains lifecycle-driven and expose reduced-motion alternatives', async () => {
  for (const name of ['WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame|Math\.random/)
    assert.match(source, /prefers-reduced-motion: reduce/)
    assert.match(source, /overflow: auto/)
    assert.match(source, /:focus-visible/)
  }
})
