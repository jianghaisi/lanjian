// Isolated presentation regression: real Vue components, no workspace or API access.
import { readFile, writeFile, mkdtemp, readdir, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron')
  const fixtureDir = process.argv.at(-1)
  app.disableHardwareAcceleration()
  app.setPath('userData', join(fixtureDir, 'user-data'))
  app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1000, height: 760, show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const timeout = setTimeout(() => app.exit(1), 30000)
  try {
    await window.loadFile(join(fixtureDir, 'index.html'))
    for (const mode of ['optional', 'blocked', 'busy']) {
      const result = await window.webContents.executeJavaScript(`window.runGuidanceViewCheck(${JSON.stringify(mode)})`)
      if (!result.ok) throw new Error(JSON.stringify(result))
      await new Promise(resolve => setTimeout(resolve, 250))
      await writeFile(resolve(`artifacts/ui/guidance-${mode}.png`), (await window.capturePage()).toPNG())
      console.info('[guidance view]', JSON.stringify(result))
    }
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
  })
} else {
  const { build } = await import('esbuild')
  const { parse, compileScript } = await import('@vue/compiler-sfc')
  const { spawn } = await import('node:child_process')
  const electron = (await import('electron')).default
  const fixtureDir = await mkdtemp(join(tmpdir(), 'lanjian-guidance-view-'))
  await mkdir(resolve('artifacts/ui'), { recursive: true })
  await build({
    stdin: { contents: `
      import { createApp, h, reactive, nextTick } from 'vue'
      import Overview from './src/renderer/features/review/components/ConsistencyOverviewPanel.vue'
      import Workflow from './src/renderer/app/components/WorkflowNextStep.vue'
      const event = { id: 'events', label: '正式事件', status: 'attention', target: 'outline', summary: '尚未将事件关联到总纲。这是可选整理，无需在纪事中重复确认；已保存的纪事仍可供 AI 参考。', issues: [] }
      const blocked = { id: 'chapterOutline', label: '当前章纲', status: 'blocked', target: 'outline', summary: '章纲依赖的总纲、卷纲或正式事件已经变化。', issues: ['当前章节大纲已过期'] }
      const workflow = { currentStep: null, steps: [], readyForProse: true }
      const state = reactive({ busy: false, overview: { status: 'attention', readyForProse: true, chapterPosition: 1, blockers: [], summary: '可以继续写作，另有可选建议', items: [event, { id: 'characterState', label: '人物状态', status: 'deferred', target: 'world', summary: '尚无已采用正文的人物状态。', issues: [] }] } })
      const actions = []
      const handlers = { onWrite: () => actions.push('write'), onSelectItem: item => actions.push(item.id + ':' + item.target) }
      createApp({ render: () => h('main', { style: 'display:grid;grid-template-columns:280px 430px;gap:48px;padding:32px;align-items:start' }, [
        h('section', [h('h2', '纪事 · 左侧指引'), h(Workflow, { workflow, overview: state.overview, busy: state.busy, ...handlers })]),
        h('section', [h('h2', '智能助笔 · 核对'), h(Overview, { overview: state.overview, busy: state.busy, ...handlers })])
      ]) }).mount('#app')
      window.runGuidanceViewCheck = async mode => {
        state.busy = mode === 'busy'
        if (mode !== 'optional') state.overview = { ...state.overview, status: 'blocked', readyForProse: false, summary: '1 项前置需要处理', blockers: blocked.issues, items: [event, blocked] }
        await nextTick()
        await document.fonts.ready
        const left = document.querySelector('[data-testid="workflow-next-step"] > button')
        const right = document.querySelector('[data-testid="consistency-next-step"] > button')
        const expected = mode === 'optional' ? 'write' : 'chapterOutline:outline'
        actions.length = 0
        left.click(); right.click()
        if (mode === 'busy') return { ok: left.disabled && right.disabled && actions.length === 0, mode }
        if (actions.join('|') !== expected + '|' + expected) return { ok: false, mode, actions }
        if (mode === 'optional') {
          if (![left, right].every(button => button.textContent.includes('继续写'))) return { ok: false, mode, step: 'writing-action-label' }
          const next = document.querySelector('[data-testid="consistency-next-step"]')
          if (!next.textContent.includes('尚未检查') || !next.textContent.includes('不是继续写作前必须确认')) return { ok: false, mode, step: 'optional-state' }
          document.querySelector('[data-consistency-id="events"]').click()
          if (actions.at(-1) !== 'events:outline') return { ok: false, mode, step: 'wrong-event-destination' }
          const explanation = document.querySelector('[data-consistency-id="events"] small')
          if (!explanation.textContent.includes('无需在纪事中重复确认') || explanation.getBoundingClientRect().height <= 0) return { ok: false, mode, step: 'hidden-explanation' }
        }
        for (const button of [left, right]) {
          const rect = button.getBoundingClientRect()
          if (rect.width <= 0 || rect.top < 0 || rect.bottom > innerHeight || rect.right > innerWidth) return { ok: false, mode, step: 'clipped-action' }
        }
        return { ok: true, mode, actions }
      }
    `, resolveDir: process.cwd(), sourcefile: 'guidance-view-fixture.js' },
    bundle: true, format: 'iife', platform: 'browser', outfile: join(fixtureDir, 'view.js'),
    define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
    plugins: [{ name: 'vue-fixture', setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
        const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
        return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts', resolveDir: dirname(path) }
      })
    } }]
  })
  const css = (await readdir(resolve('out/renderer/assets'))).find(name => name.endsWith('.css'))
  if (!css) throw new Error('Build the desktop app before running this check.')
  await writeFile(join(fixtureDir, 'index.html'), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(resolve('out/renderer/assets', css)).href}"><div id="app"></div><script src="./view.js"></script>`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [fileURLToPath(import.meta.url), fixtureDir], { env, stdio: 'inherit', windowsHide: true })
  child.on('exit', code => { process.exitCode = code ?? 1 })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
}
