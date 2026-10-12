import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { _electron } from 'playwright'

const root = await mkdtemp(join(tmpdir(), 'lanjian-recovery-review-'))
await mkdir(join(root, 'profile'))
const output = resolve(process.env.RECOVERY_REVIEW_OUTPUT || '../.trellis/tasks/09-21-v3-cinematic-boot-archive/research/10-01-recovery-review-native')
await mkdir(output, { recursive: true })
const path = file => JSON.stringify(resolve(file).replaceAll('\\', '/'))
// Compile the actual AppShell total-outline sheet, not a recreated test layout.
const shell = await readFile('src/renderer/app/AppShell.vue', 'utf8')
const start = shell.indexOf('<DialogTransition @escape="planningAdoptionPreview = null">')
assert.ok(start > 0)
const adoption = shell.slice(start, shell.indexOf('</DialogTransition>', start) + '</DialogTransition>'.length)
await writeFile(join(root, 'Fixture.vue'), `<script setup>
import {ref} from 'vue';
import Recovery from ${path('src/renderer/features/manuscript/components/ManuscriptRecoveryDialog.vue')};
import DialogTransition from ${path('src/renderer/ui/DialogTransition.vue')};
import StudioIcon from ${path('src/renderer/ui/StudioIcon.vue')};
const visible=ref(false),busy=ref(''),planningAdoptionPreview=ref(null),planningAdoptionBusy=ref(false);
const items=ref([1,2].map(n=>({id:'draft-'+n,chapterId:n,chapterTitle:'旧章节'+n,source:'renderer',updatedAt:'2026-10-01T02:00:00Z',draftTitle:'恢复稿'+n,draftContent:'第'+n+'份恢复正文。\\n'.repeat(500),currentTitle:'正式稿'+n,currentContent:'第'+n+'份正式正文。\\n'.repeat(500),status:n===1?'conflict':'recoverable'})));
const preview={candidate:{title:'候选总纲',characterCount:8000,excerpt:'这是尚待作者确认的候选。\\n'.repeat(300)},current:{exists:true,revision:3,characterCount:7000,excerpt:'当前正式总纲完整保留。\\n'.repeat(300)},affected:{chapterOutlines:24,confirmedVolumes:3,totalConfirmation:true},changes:true};
window.fixture={events:[],get busy(){return busy.value},set busy(v){busy.value=v},open(){visible.value=true}};
function confirmPlanningTotalAdoption(){window.fixture.events.push('adopt')}
function record(action){window.fixture.events.push(action)}
</script><template><main class="redesigned-studio">
<button id="open-recovery" @click="visible=true">核对恢复稿</button><button id="open-adoption" @click="planningAdoptionPreview=preview">核对总纲</button>
<DialogTransition @escape="!busy && (visible=false)"><Recovery v-if="visible" :items="items" :busy-id="busy" @close="visible=false" @restore="record('restore')" @discard="record('discard')" /></DialogTransition>
${adoption}</main></template>`)
await writeFile(join(root, 'entry.js'), `import {createApp} from 'vue';import Fixture from './Fixture.vue';
import ${path('src/renderer/assets/desktop.css')};import ${path('src/renderer/assets/desktop-redesign.css')};import ${path('src/renderer/assets/interaction-motion.css')};
createApp(Fixture).mount('#app');`)
await build({ configFile: false, root, plugins: [vue()], define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }, resolve: { alias: { vue: resolve('node_modules/vue/dist/vue.esm-bundler.js') } },
  build: { outDir: join(root, 'bundle'), emptyOutDir: false, lib: { entry: join(root, 'entry.js'), name: 'RecoveryFixture', formats: ['iife'], fileName: () => 'fixture.js', cssFileName: 'fixture' } }, logLevel: 'error' })
await writeFile(join(root, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="stylesheet" href="bundle/fixture.css"><style>
:root{--ink:#eef0e9;--ink-2:#cdd9d1;--paper:#252e29;--surface:#252e29;--surface-muted:#1c2520;--line:#4e5d53;--jade:#85b9a4;--jade-wash:#2a3d33;--muted:#adbbb1;--cinnabar:#f8b086;--serif:serif;--sans:system-ui}html[data-test-theme=light]{--ink:#24372d;--ink-2:#3d4e43;--paper:#f4f1e9;--surface:#faf8f1;--surface-muted:#eeece3;--line:#c8cfc7;--jade:#376d56;--jade-wash:#e4eee7;--muted:#5f6d64;--cinnabar:#9b4830}body{background:var(--surface);color:var(--ink)}main{padding:24px}#app{height:100vh}
</style><div id="app"></div><script src="bundle/fixture.js"></script></html>`)
await writeFile(join(root, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.setMenu(null);w.loadFile(${JSON.stringify(join(root, 'index.html'))});});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ args: [join(root, 'main.cjs')], env })
const page = await app.firstWindow(), owner = await app.browserWindow(page)
page.setDefaultTimeout(15000)
const checks = [], samples = {}, errors = []
page.on('pageerror', e => errors.push(e.message))
async function capture(name) {
  await page.screenshot({ animations: 'allow' })
  const png = await owner.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
}
async function settle(selector) {
  await page.locator(selector).evaluate(async e => { await Promise.allSettled(e.getAnimations({ subtree: true }).map(a => a.finished)) })
}
try {
  await page.locator('#open-recovery').click()
  const review = page.getByTestId('manuscript-recovery-dialog')
  await settle('.recovery-backdrop')
  assert.equal(await review.getByRole('button', { name: '暂时关闭恢复窗口' }).evaluate(e => e === document.activeElement), true)
  await review.getByRole('button', { name: '查看完整正文' }).click()
  assert.ok((await review.locator('.draft-paper pre').textContent()).length > 2000)
  await review.locator('.recovery-reading').evaluate(e => e.scrollTop = e.scrollHeight)
  samples.footer = await review.locator('.restore-action').evaluate(e => {
    const r = e.getBoundingClientRect(); return { hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), bottom: r.bottom, height: innerHeight }
  })
  assert.equal(samples.footer.hit, true); assert.ok(samples.footer.bottom < samples.footer.height)
  await capture('01-dark-full-recovery')
  await review.locator('[data-recovery-id="draft-1"]').focus(); await page.keyboard.press('ArrowDown')
  assert.equal(await review.locator('[data-recovery-id="draft-2"]').getAttribute('aria-selected'), 'true')
  assert.equal(await review.locator('.recovery-reading').evaluate(e => e.scrollTop), 0)
  await review.evaluate(e => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  assert.equal(await review.count(), 1)
  await page.evaluate(() => window.fixture.busy = 'draft-2')
  await page.keyboard.press('Escape'); assert.equal(await review.count(), 1)
  assert.equal(await review.getByRole('button', { name: '暂时关闭恢复窗口' }).isDisabled(), true)
  await page.evaluate(() => window.fixture.busy = '')
  checks.push('complete-text-fixed-actions-selection-reset-and-ime-busy-close-guards')

  samples.reversal = await page.evaluate(async () => {
    const root = document.querySelector('.recovery-backdrop')
    root.querySelector('.close-button').click()
    await new Promise(requestAnimationFrame)
    const retired = { inert: root.inert, hidden: root.getAttribute('aria-hidden') }
    document.querySelector('#open-recovery').click()
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const live = [...document.querySelectorAll('.recovery-backdrop')].filter(e => !e.inert)
    return { retired, live: live.length, focus: live[0]?.contains(document.activeElement) }
  })
  assert.deepEqual(samples.reversal.retired, { inert: true, hidden: 'true' })
  assert.equal(samples.reversal.live, 1); assert.equal(samples.reversal.focus, true)
  await page.keyboard.press('Escape'); await review.waitFor({ state: 'detached' })
  assert.equal(await page.locator('#open-recovery').evaluate(e => e === document.activeElement), true)
  checks.push('inert-exit-rapid-reopen-and-trigger-focus')

  await owner.evaluate(w => { w.setContentSize(1100, 760); w.webContents.setZoomFactor(1.25) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.documentElement.dataset.testTheme = 'light')
  await page.locator('#open-recovery').click()
  await review.getByRole('button', { name: '查看完整正文' }).click()
  samples.compact = await review.evaluate(e => {
    const r = e.getBoundingClientRect(), b = e.querySelector('.restore-action'), p = b.getBoundingClientRect()
    return { bottom: r.bottom, right: r.right, width: innerWidth, height: innerHeight, hit: b.contains(document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2)), effects: e.parentElement.getAnimations({ subtree: true }).length, colour: getComputedStyle(e).backgroundColor }
  })
  assert.ok(samples.compact.bottom <= samples.compact.height && samples.compact.right <= samples.compact.width)
  assert.equal(samples.compact.hit, true); assert.equal(samples.compact.effects, 0)
  await capture('02-light-compact-recovery')
  await page.keyboard.press('Escape'); await review.waitFor({ state: 'detached' })
  checks.push('theme-aware-compact-recovery-and-reduced-motion')

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('#open-adoption').click()
  const adoptionSheet = page.getByTestId('planning-adoption-preview')
  await adoptionSheet.waitFor()
  assert.equal(await adoptionSheet.evaluate(e => e.getAnimations().some(a => a instanceof CSSAnimation)), false)
  await settle('.planning-adoption-backdrop')
  await adoptionSheet.evaluate(e => e.scrollTop = e.scrollHeight)
  const hit = await page.getByTestId('confirm-total-adoption').evaluate(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })
  assert.equal(hit, true)
  await page.getByTestId('confirm-total-adoption').focus(); await page.keyboard.press('Tab')
  assert.equal(await adoptionSheet.getByRole('button', { name: '关闭影响预览' }).evaluate(e => e === document.activeElement), true)
  await capture('03-actual-adoption-markup')
  await page.keyboard.press('Escape'); await adoptionSheet.waitFor({ state: 'detached' })
  assert.equal(await page.locator('#open-adoption').evaluate(e => e === document.activeElement), true)
  assert.deepEqual(await page.evaluate(() => window.fixture.events), [])
  assert.deepEqual(errors, [])
  checks.push('actual-shell-adoption-keyboard-fixed-actions-no-implicit-adoption')
  await writeFile(join(output, 'verification.json'), JSON.stringify({ checks, samples, errors, root }, null, 2))
  console.log(JSON.stringify({ checks, samples, output }))
} catch (error) {
  await capture('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, samples, errors, root }, null, 2))
  console.error(error); process.exitCode = 1
} finally { await app.close() }
