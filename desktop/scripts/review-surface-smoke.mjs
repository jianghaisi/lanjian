// Real Vue components in an isolated Electron fixture; no providers or work files.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { _electron } from 'playwright'
const root = await mkdtemp(join(tmpdir(), 'lanjian-review-surface-'))
await mkdir(join(root, 'profile'), { recursive: true })
const output = resolve(process.env.REVIEW_SURFACE_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-review-surface-native')
await mkdir(output, { recursive: true })
const entry = join(root, 'entry.js')
await writeFile(entry, `
import { createApp, h, ref } from 'vue';
import DialogTransition from ${JSON.stringify(resolve('src/renderer/ui/DialogTransition.vue').replaceAll('\\', '/'))};
import ${JSON.stringify(resolve('src/renderer/assets/interaction-motion.css').replaceAll('\\', '/'))};
import Review from ${JSON.stringify(resolve('src/renderer/features/assistant/components/WritingRebaseDialog.vue').replaceAll('\\', '/'))};
import Tasks from ${JSON.stringify(resolve('src/renderer/features/assistant/components/TaskCenterPanel.vue').replaceAll('\\', '/'))};
const visible = ref(false), busy = ref(false), status = ref('running');
const base = '第一处原文。\\n'+ '中间保留的内容。\\n'.repeat(30) + '第二处原文。';
const current = base.replace('第一处原文。','作者写的新开头。').replace('第二处原文。','作者写的新结尾。');
const proposed = base.replace('第一处原文。','候选建议的新开头。').replace('第二处原文。','候选建议的新结尾。');
window.reviewFixture = { confirmations: [], get busy(){return busy.value}, set busy(v){busy.value=v}, complete(){status.value='succeeded'}, restart(){status.value='running'} };
createApp({render(){return h('main', [
h('button', {id:'open-review',onClick:()=>visible.value=true},'审阅候选'),
h(DialogTransition,{onEscape:()=>{if(!busy.value)visible.value=false}},{default:()=>visible.value ? h(Review,{base,current,proposed,busy:busy.value,onClose:()=>visible.value=false,onConfirm:choices=>window.reviewFixture.confirmations.push(choices)}) : null}),
h(Tasks,{items:[{id:'fixture',label:'写作任务',status:status.value,detail:'隔离界面验证；没有启动模型',actions:['view'],updatedAt:'2026-10-01T01:00:00Z',attempt:1}]})
])}}).mount('#app');`)
await build({ configFile: false, root, plugins: [vue()], define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }, resolve: { alias: { vue: resolve('node_modules/vue/dist/vue.esm-bundler.js') } },
  build: { outDir: join(root, 'bundle'), emptyOutDir: false, lib: { entry, name: 'ReviewFixture', formats: ['iife'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }, logLevel: 'error' })
await writeFile(join(root, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="stylesheet" href="bundle/fixture.css"><style>
:root{--ink:#eef0e9;--paper:#252e29;--surface:#252e29;--surface-muted:#1c2520;--line:#4e5d53;--jade:#85b9a4;--muted:#adbbb1;--serif:"Noto Serif SC",serif;--sans:system-ui;--form-help:13px}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px var(--sans)}main{padding:24px}button{padding:10px 16px;color:var(--ink);background:var(--surface);border:1px solid var(--line)}button:disabled{opacity:.45}.primary{background:var(--jade);color:#17251d}.task-center{max-width:600px;margin-top:30px}.task-card{padding:20px;border:1px solid var(--line);background:var(--surface)}.task-card-body>header{display:flex;justify-content:space-between}.task-center-heading{display:flex;justify-content:space-between}.task-center-heading small{display:block}.task-center-filters{display:flex;margin:20px 0}.task-card-mark{display:none}pre{margin-top:0}
</style><div id="app"></div><script src="bundle/fixture.js"></script></html>`)
await writeFile(join(root, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.setMenu(null);w.loadFile(${JSON.stringify(join(root, 'index.html'))});});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ args: [join(root, 'main.cjs')], env })
app.process().stderr?.on('data', chunk => process.stderr.write(chunk))
const page = await app.firstWindow().catch(async error => { await app.close(); throw error }), owner = await app.browserWindow(page)
const checks = [], samples = {}, errors = []
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  await page.screenshot({ animations: 'allow' })
  const png = await owner.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
try {
  await page.locator('#open-review').click()
  const review = page.getByTestId('writing-rebase-dialog')
  await review.waitFor()
  const fields = review.locator('fieldset')
  assert.equal(await fields.count(), 2)
  assert.equal(await page.getByTestId('confirm-writing-rebase').isDisabled(), true)
  await review.getByRole('button', { name: '下一处 ↓' }).click()
  assert.equal(await fields.nth(1).evaluate(e => e === document.activeElement), true)
  await fields.nth(1).locator('input[value=candidate]').check()
  await review.getByRole('button', { name: '↑ 上一处' }).click()
  await fields.nth(0).locator('input[value=current]').check()
  assert.match(await page.getByTestId('rebase-result').textContent(), /作者写的新开头/)
  assert.match(await page.getByTestId('rebase-result').textContent(), /候选建议的新结尾/)
  assert.equal(await page.getByTestId('confirm-writing-rebase').isEnabled(), true)
  await capture('01-review-page')
  await page.evaluate(() => window.reviewFixture.busy = true)
  await page.keyboard.press('Escape')
  assert.equal(await review.evaluate(e => e.open), true)
  await page.evaluate(() => window.reviewFixture.busy = false)
  await review.evaluate(e => e.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',isComposing:true,bubbles:true})))
  assert.equal(await review.evaluate(e=>e.open),true)
  // Native close must release modality before the departing paint is removed.
  samples.nativeExit = await page.evaluate(async () => {
    const root=document.querySelector('dialog');root.querySelector('header button').click();
    await new Promise(requestAnimationFrame);
    const state={open:root.open,inert:root.inert,hidden:root.getAttribute('aria-hidden'),connected:root.isConnected,display:getComputedStyle(root).display,focus:document.activeElement.id};
    await new Promise(resolve=>setTimeout(resolve,55));
    window.reviewFixture.exitOpacity=Number(getComputedStyle(root).opacity);
    root.querySelector('button').focus();window.reviewFixture.retiredFocusRejected=!root.contains(document.activeElement);
    return state
  })
  assert.deepEqual(samples.nativeExit,{open:false,inert:true,hidden:'true',connected:true,display:'flex',focus:'open-review'})
  samples.exitOpacity=await page.evaluate(()=>window.reviewFixture.exitOpacity)
  assert.ok(samples.exitOpacity>0&&samples.exitOpacity<1)
  assert.equal(await page.evaluate(()=>window.reviewFixture.retiredFocusRejected),true)
  await page.locator('#open-review').click()
  await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===1)
  await review.filter({visible:true}).last().evaluate(async e=>{await Promise.allSettled(e.getAnimations().map(a=>a.finished))})
  await page.waitForFunction(()=>document.querySelectorAll('dialog').length===1)
  assert.equal(await review.evaluate(e=>e.contains(document.activeElement)&&e.open&&!e.inert),true)
  checks.push('native-inert-painted-exit-immediate-focus-return-and-rapid-reopen')
  await owner.evaluate(w => { w.setContentSize(1100, 760); w.webContents.setZoomFactor(1.25) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(()=>{const styles={'--ink':'#24372d','--paper':'#f4f1e9','--surface':'#faf8f1','--surface-muted':'#eeece3','--line':'#c8cfc7','--jade':'#376d56','--muted':'#5f6d64'};for(const [key,value]of Object.entries(styles))document.documentElement.style.setProperty(key,value)})
  samples.compact = await review.evaluate(e => {
    const r = e.getBoundingClientRect(), b = e.querySelector('footer button.primary'), br = b.getBoundingClientRect()
    return { width: innerWidth, height: innerHeight, left: r.left, right: r.right, bottom: r.bottom, hit: b.contains(document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2)) }
  })
  assert.ok(samples.compact.left >= 0 && samples.compact.right <= samples.compact.width + 1 && samples.compact.bottom <= samples.compact.height + 1)
  assert.equal(samples.compact.hit, true)
  await capture('02-review-compact')
  await page.keyboard.press('Escape')
  await review.waitFor({ state: 'detached' })
  assert.equal(await page.locator('#open-review').evaluate(e=>e===document.activeElement),true)
  assert.deepEqual(await page.evaluate(() => window.reviewFixture.confirmations), [])
  checks.push('conflict-navigation-current-candidate-choices-unresolved-busy-and-close-guards')
  checks.push('compact-review-fixed-actions-and-return-without-adoption')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.reviewFixture.complete())
  await page.getByText('已完成', { exact: true }).waitFor()
  await page.waitForFunction(() => {
    const e = document.querySelector('.task-record-leave-active')
    if (!e) return false
    window.departure = { inert: e.inert, hidden: e.getAttribute('aria-hidden') }
    return true
  })
  assert.deepEqual(await page.evaluate(() => window.departure), { inert: true, hidden: 'true' })
  await page.getByTestId('task-center-item-fixture').waitFor({ state: 'detached' })
  await page.getByTestId('task-filter-all').click()
  await page.getByText('已完成', { exact: true }).waitFor()
  checks.push('completion-readable-then-inert-departure-history-retains-real-record')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, samples, output }))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  console.error(error); process.exitCode = 1
} finally { await app.close() }
