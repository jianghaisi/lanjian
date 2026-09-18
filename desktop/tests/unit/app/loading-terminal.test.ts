import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as BootCompletion from '../../../src/renderer/app/composables/use-boot-completion'

function componentUrl(name: string): URL {
  const paths: Record<string, string> = {
    'AppBootScreen.vue': '../../../src/renderer/app/components/AppBootScreen.vue',
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
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/composables\/use-boot-completion['"];?/g,
    (_, names: string) => `const { ${names} } = BootCompletion;`)
  const compiled = await transformWithEsbuild(code, relative + '.ts', { loader: 'ts' })
  return new Function('Vue', 'dependencies', 'BootCompletion', compiled.code.replace('export default', 'return'))(Vue, dependencies, BootCompletion)
}

const render = async (name: string, props: Record<string, unknown>) => renderToString(Vue.createSSRApp(await loadComponent(componentUrl(name)), props))

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

test('orange progress lines patrol only the completed range with distinct boot and workspace completion timing', async () => {
  const boot = await render('AppBootScreen.vue', { phase: 'editor' })
  const work = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'workspace', slow: false })
  const bootReady = await render('AppBootScreen.vue', { phase: 'ready' })
  const workReady = await render('WorkspaceLoadingScreen.vue', { title: '作品', phase: 'ready', slow: false })
  for (const html of [boot, work]) {
    assert.match(html, /data-loader-progress="50"/)
  }
  assert.match(bootReady, /data-loader-progress="100"/)
  assert.match(workReady, /data-loader-progress="100"/)

  for (const name of ['AppBootScreen.vue', 'WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.match(source, /LINE_START_PERCENT = 5/)
    assert.match(source, /line\.getBoundingClientRect\(\)/)
    assert.match(source, /line\.style\.transitionDuration = '0ms'/)
    assert.match(source, /line\.style\.left = `\$\{currentLeft\}px`/)
    assert.match(source, /transition-property:left,opacity/)
    assert.match(source, /transition-timing-function:linear/)
    assert.match(source, /@transitionend="continueProgressPatrol"/)
  }
  const bootSource = await readFile(new URL('../../../src/renderer/app/components/AppBootScreen.vue', import.meta.url), 'utf8')
  const workspaceSource = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.match(bootSource, /BOOT_COMPLETION_DURATION_MS/)
  assert.equal(BootCompletion.BOOT_COMPLETION_DURATION_MS, 3000)
  assert.match(bootSource, /terminal-orbit-slow 12s linear infinite/)
  assert.match(bootSource, /terminal-orbit-fast 7s linear infinite reverse/)
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
  assert.match(appShell, /slow: false,\s+visible: true/)
  assert.doesNotMatch(appShell, /workspaceOpeningShowTimer/)
  assert.match(appShell, /advanceWorkspaceOpeningPhase\(\)/)
  assert.match(appShell, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => \{/)
  assert.match(appShell, /await (?:ports\.)?waitForWorkspaceOpeningPhase\(generation, 'ready'\)/)
  assert.match(source, /archive-phase-enter \.16s ease-out both/)
  assert.doesNotMatch(source, /@keyframes archive-phase-enter\{[^}]*translate/)
  assert.match(desktopCss, /\.workspace-loading-fade-enter-active\s*\{\s*transition: none;/)
  assert.match(appShell, /:sidebar-width="explorerWidth"/)
})

test('both approved themes render boot and archive phases without demo book data or synthetic percent', async () => {
  for (const theme of ['standard', 'impact']) {
    const boot = await render('AppBootScreen.vue', { phase: 'editor', theme, reducedMotion: true })
    const work = await render('WorkspaceLoadingScreen.vue', { title: '作者传入的当前作品', phase: 'workspace', slow: false, theme, preview: true })
    for (const html of [boot, work]) {
      assert.match(html, new RegExp(`data-loader-theme="${theme}"`))
      assert.doesNotMatch(html, /124,806|第十七章断点|AI COPILOT|SYSTEM ONLINE|\d+%<\/strong>/)
    }
    assert.match(boot, /reduce-motion/)
    assert.match(work, /动画预览 · 非真实载入/)
    assert.match(work, /关闭预览/)
    assert.match(work, /作者传入的当前作品/)
    assert.match(work, theme === 'impact' ? /UNSEAL/ : /OPEN/)
    if (theme === 'impact') assert.match(boot, /impact-slash/)
  }
})

test('both loaders derive their palette from all three app themes independently of motion style', async () => {
  for (const name of ['AppBootScreen.vue', 'WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.match(source, /data-theme="xuanzhi"/)
    assert.match(source, /data-theme="moye"/)
    assert.match(source, /var\(--color-orange/)
  }
  const boot = await readFile(new URL('../../../src/renderer/app/components/AppBootScreen.vue', import.meta.url), 'utf8')
  const workspace = await readFile(new URL('../../../src/renderer/features/library/components/WorkspaceLoadingScreen.vue', import.meta.url), 'utf8')
  assert.match(boot, /--loader-canvas:#1c1b17/)
  assert.match(boot, /--loader-canvas:#0c100e/)
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

test('archive slow message preserves ready semantics, title escaping and real completion', async () => {
  const html = await render('WorkspaceLoadingScreen.vue', { title: '<script>private()</script>', phase: 'ready', slow: true })
  assert.match(html, /&lt;script&gt;/)
  assert.equal((html.match(/已完成/g) ?? []).length, 6)
  assert.match(html, /这部作品需要多一点时间/)
  assert.doesNotMatch(html, /<script>private|进行中/)
})

test('cold startup is distinct, displays error recovery and never infers book cursor restoration', async () => {
  const html = await render('AppBootScreen.vue', { phase: 'projects', error: '作品索引暂时不可读' })
  assert.match(html, /SYSTEM INITIALIZATION/)
  assert.match(html, /作品索引暂时不可读/)
  assert.match(html, /data-testid="app-boot-retry"/)
  assert.doesNotMatch(html, /data-testid="app-boot-skip"|先进入作品库|隐藏启动画面/)
  assert.match(html, /待处理/)
  assert.doesNotMatch(html, /恢复光标|已恢复正文|<b>已就绪<\/b>|动画预览/)
})

test('startup replay explicitly identifies demonstration and ready status', async () => {
  const html = await render('AppBootScreen.vue', { phase: 'ready', preview: true })
  assert.match(html, /动画预览 · 非真实载入/)
  assert.match(html, /关闭预览/)
  assert.equal((html.match(/<b>已就绪<\/b>/g) ?? []).length, 4)
  assert.doesNotMatch(html, /data-testid="app-boot-retry"/)
})

test('real startup auto-completes after readiness, waits for native visibility, and never bypasses core initialization', async () => {
  const html = await render('AppBootScreen.vue', { phase: 'ready' })
  const boot = await readFile(new URL('../../../src/renderer/app/components/AppBootScreen.vue', import.meta.url), 'utf8')
  const appShell = (await Promise.all(['app/AppShell.vue', 'app/use-workspace-controller.js', 'features/library/composables/create-opening-actions.js'].map(path => readFile(new URL('../../../src/renderer/' + path, import.meta.url), 'utf8')))).join('\n')
  const fieldCatalog = await readFile(new URL('../../../src/contracts/assistant/assistant-field-catalog.ts', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../../../src/preload/index.ts', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../../src/main/bootstrap/create-main-window.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /data-testid="app-boot-skip"|隐藏启动画面/)
  assert.match(boot, /visualReady/)
  assert.match(boot, /onWindowShown\(revealBootMotion\)/)
  assert.match(preload, /ipcRenderer\.on\('app:window-shown'/)
  assert.match(main, /window\.on\('show', notifyWindowShown\)/)
  assert.match(main, /window\.on\('restore', notifyWindowShown\)/)
  assert.match(main, /window\.webContents\.on\('did-finish-load', notifyWindowShown\)/)
  assert.match(main, /window\.isVisible\(\)[\s\S]*window\.webContents\.send\('app:window-shown'\)/)
  assert.match(boot, /app-boot:not\(\.motion-ready\)[^\n]*animation-play-state:paused!important/)
  assert.match(appShell, /const opening = ref\(!smokeRuntime \|\| appSearchParams\.get\('boot'\) === '1'\)/)
  assert.match(boot, /readyToEnter = computed\(\(\) => props\.phase === 'ready' && !props\.error && !props\.preview\)/)
  assert.match(boot, /readyToAnimate = computed\(\(\) => readyToEnter\.value && motionReady\.value\)/)
  assert.match(boot, /useBootCompletion\(readyToAnimate/)
  assert.doesNotMatch(html, /现在进入|data-testid="app-boot-enter"/)
  assert.match(appShell, /useCompanionBoot\(bootPhase, bootError, bootPreview\)/)
  assert.match(appShell, /@complete="dismissOpening"/)
  assert.doesNotMatch(appShell, /openingEnabled|updateOpeningPreference|lanjian-opening-enabled|lanjian-opening-seen/)
  assert.doesNotMatch(appShell, /启动时播放岚笺开场动画/)
  assert.doesNotMatch(fieldCatalog, /AppShell\.openingEnabled|启动时播放岚笺开场动画/)
})

test('ordinary boot has no manual ready entry; preview retains its explicit close action', async () => {
  for (const phase of ['projects', 'models', 'ready']) {
    const html = await render('AppBootScreen.vue', { phase })
    assert.doesNotMatch(html, /收束动画|秒后自动进入|秒完成动画|class="boot-note"/)
    assert.doesNotMatch(html, /现在进入|data-testid="app-boot-enter"/)
  }
  const preview = await render('AppBootScreen.vue', { phase: 'ready', preview: true })
  assert.match(preview, /仅重播视觉界面/)
  assert.doesNotMatch(preview, /data-testid="app-boot-enter"/)
})

test('both loading components are lifecycle-driven and expose reduced-motion alternatives', async () => {
  for (const name of ['AppBootScreen.vue', 'WorkspaceLoadingScreen.vue']) {
    const source = await readFile(componentUrl(name), 'utf8')
    assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame|Math\.random/)
    assert.match(source, /prefers-reduced-motion: reduce/)
    assert.match(source, /overflow: auto/)
    assert.match(source, /:focus-visible/)
  }
})
