import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { _electron } from 'playwright'
import JSZip from 'jszip'
import { readPluginPackage } from '@lanjian/writing-plugin-package'
import { createMarketApp } from '../../../services/plugin-marketplace/dist/app.js'
import { pluginDraftTemplate } from '../../src/main/modules/writing-plugins/domain/draft-templates.ts'

// UI fixtures only: real isolated service/package validation and anonymous desktop
// download. This does not replace the separate OIDC/system-browser acceptance.
const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-market-ui-')))
const evidence = resolve(process.env.LANJIAN_PLUGIN_EVIDENCE_DIR || '../.trellis/tasks/09-20-v3-plugin-marketplace-and-personal-authoring/research/ui-motion-tools/market')
await mkdir(evidence, { recursive: true })
const market = await createMarketApp(join(root, 'service'), async () => { throw new Error('UI fixtures never authenticate') })
const official = 'a'.repeat(64), community = 'b'.repeat(64)
const db = new DatabaseSync(join(root, 'service/catalog.sqlite'))
db.prepare('INSERT INTO publishers(id,official) VALUES(?,1)').run(official); db.close()
const fixtures = [
  ['仙侠世界构筑', 'genre', '整理宗门、境界与修行规则，为长篇仙侠建立一致的世界底稿。', ['worldbuilding'], true],
  ['克制的叙事', 'style', '减少解释，让动作与细节承接情绪，保留人物各自的声线。', [], false],
  ['章节节奏规划', 'workflow', '从本章目标到场景安排，逐步梳理铺垫、转折与收束。', ['plot'], true],
  ['人物关系笔记', 'characters', '围绕动机、关系变化与人物冲突，补充角色塑造的写作依据。', [], false],
  ['伏笔回收清单', 'plot', '整理未兑现的承诺与情节线索，提醒长篇创作中的前后呼应。', ['review'], false],
  ['古风用语参考', 'research', '提供称谓、器物与日常表达的资料组织方法，减少叙述出戏。', [], false],
  ['对白打磨', 'style', '让每段对白承载人物意图，减少重复说明与过于整齐的问答。', ['review'], true],
  ['作者决策记录', 'interaction', '把创作选择整理成明确的问题，记录作者对故事方向的决定。', [], false],
  ['段落整理', 'format', '检查段落呈现与提示框约定，帮助保持一致的阅读节奏。', [], false],
  ['字数工具', 'tools', '统计输入文字的字符数，适合写作片段与对白长度的快速核对。', [], true],
  ['扩展分类示例', 'custom.reference', '用于验证自定义分类筛选的隔离样例。', [], false],
  ['长标题与多类别验证'.repeat(5), 'review', '用于验证长文本在窄窗口中的换行与完整详情。'.repeat(30), ['style'], false]
]
const fixturePackages = []
for (let index = fixtures.length - 1; index >= 0; index--) {
  const [name, category, description, extra, isOfficial] = fixtures[index]
  const draft = pluginDraftTemplate(`test.market-ui.p${index}`, category === 'tools' ? 'code' : 'context')
  const manifest = JSON.parse(draft.manifestText)
  Object.assign(manifest, { name, description, categoryIds: [category, ...extra], tags: index === 0 ? ['仙侠', '长篇'] : ['写作'] })
  if (manifest.contributions?.length) { manifest.contributions[0].name = name.slice(0, 60); manifest.contributions[0].text = description }
  const zip = new JSZip(); zip.file('lanjian-plugin.json', JSON.stringify(manifest)); for (const file of draft.files) zip.file(file.path, file.content)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), pkg = await readPluginPackage(bytes), operationId = randomUUID(), owner = isOfficial ? official : community
  fixturePackages[index] = bytes
  const prepared = market.catalog.prepare(owner, { operationId, manifest: pkg.manifest, digest: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, upstream: null })
  const release = await market.service.commit(operationId, owner, prepared.ticket, bytes); assert.equal(release.state, 'published')
}
let failCatalog = false, failDownload = false, requests = 0, heldRequest
const releaseHolds = []
function holdNext(path) {
  let release, started
  const wait = new Promise(resolve => { release = resolve }), begun = new Promise(resolve => { started = resolve })
  heldRequest = { path, wait, started, release }
  releaseHolds.push(release)
  return { started: begun, release }
}
market.app.addHook('onRequest', async (request, reply) => {
  requests++
  if ((failCatalog && request.url === '/catalog') || (failDownload && request.url.startsWith('/download/'))) return reply.code(503).send({ error: 'fixture-offline' })
  if (heldRequest && request.url.startsWith(heldRequest.path)) { const held = heldRequest; heldRequest = null; held.started(); await held.wait }
})
await market.app.listen({ host: '127.0.0.1', port: 0 })
const origin = `http://127.0.0.1:${market.app.server.address().port}`
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => typeof v === 'string' && !k.startsWith('LANJIAN_') && !['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL'].includes(k)))
const checks = [], errors = [], screenshots = [], layouts = [], build = resolve(process.env.LANJIAN_BUILT_DESKTOP_DIR || 'out-plugin-marketplace-check', 'main/index.js')
let app, page
const watchdog = setTimeout(() => app?.process().kill('SIGKILL'), 240000); watchdog.unref()
async function launch(connected) {
  const profile = join(root, connected ? 'online' : 'offline'), books = join(profile, 'books'); await mkdir(books, { recursive: true })
  const env = { ...baseEnv, LANJIAN_USER_DATA_PATH: profile, LANJIAN_GLOBAL_MODEL_DATA_PATH: join(profile, 'global-model-data/v1') }
  if (connected) Object.assign(env, { LANJIAN_MARKET_ORIGIN: origin, LANJIAN_MARKET_ISSUER: origin, LANJIAN_MARKET_CLIENT_ID: 'ui-test', LANJIAN_MARKET_TEST_LOOPBACK: '1' })
  app = await _electron.launch({ args: [build, '--disable-gpu'], env }); page = await app.firstWindow(); page.setDefaultTimeout(25000)
  page.on('pageerror', e => errors.push(e.message)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => Boolean(window.novelDesktop?.writingPlugins))
  await page.evaluate(async books => { sessionStorage.setItem('lanjian-opening-seen','true'); await window.companionSettings.update({ voice: { mute: true, textModel: false, preload: false } }); await window.novelDesktop.projects.create({ parentPath: books, name: '插件界面验收 · 测试数据', genre: '仙侠' }) }, books)
  await page.reload(); await page.getByTestId('app-boot-enter').click(); await page.getByTestId('app-boot').waitFor({ state:'hidden' })
  if (await page.locator('.project-library').isVisible()) { await page.locator('.work-item-open').filter({ hasText:'插件界面验收' }).first().click(); await page.getByTestId('workspace-loading').waitFor({ state:'hidden' }) }
  await page.locator('[data-nav-parent="settings"]').click(); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="plugin-library"] .catalog-item').length === 8); if (connected) assert.equal(requests, 0, 'Bundled default must not contact even a configured market'); await page.getByTestId('plugins-nav-market').click()
}
const ui = () => page.getByTestId('plugin-market')
const dialog = () => page.getByTestId('market-detail')
const count = async n => { await page.waitForFunction(n => document.querySelectorAll('[data-testid="plugin-market"] .catalog-item').length === n && document.querySelector('[data-testid="plugin-market"]')?.getAttribute('aria-busy') === 'false', n) }
async function fit() {
  const overflow = await page.getByTestId('writing-plugin-settings').evaluate(el => { const result = []; for(let n = el;n;n=n.parentElement) if(n.scrollWidth > n.clientWidth+1) result.push({ node:n.className, width:n.clientWidth, scroll:n.scrollWidth }); return result })
  assert.deepEqual(overflow, [])
}
async function shot(name) {
  if (!await dialog().isVisible()) await page.locator('.settings-editor').evaluate(el => { el.scrollTop = 0 })
  await fit()
  if (['market-light','market-compact','market-dark'].includes(name)) {
    const grid = await ui().locator('.catalog').evaluate(el => ({ width: el.clientWidth, columns: getComputedStyle(el).gridTemplateColumns.split(' ').length, cardWidth: el.firstElementChild.getBoundingClientRect().width, cardHeight: el.firstElementChild.getBoundingClientRect().height }))
    assert.equal(grid.columns, name === 'market-light' ? 4 : 3, 'Available desktop width should show more plugins per row')
    assert.ok(grid.cardWidth >= 240, 'Plugin titles and summaries retain a readable card width')
    assert.ok(grid.cardHeight <= 130, 'Compact catalog cards should reserve full prose for the modal')
    layouts.push({name, ...grid, viewport: await page.evaluate(() => ({width: innerWidth, height: innerHeight, dpr: devicePixelRatio}))})
  }
  if (['market-light','market-compact','market-dark'].includes(name)) { const bounds = await ui().locator('.catalog-item').first().boundingBox(); assert.ok(bounds && bounds.y + bounds.height < await page.evaluate(() => innerHeight - 26), 'At least one full plugin card must be visible without scrolling') } await page.screenshot({ path: join(evidence, name+'.png') }); screenshots.push(name)
}
try {
  await launch(true); await count(10); assert.equal(await page.locator('.installed-plugins').isVisible(), false)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const enter = await ui().locator('.catalog-item').first().evaluate(async el => {
    el.click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const d = document.querySelector('[data-testid="market-detail"]'), animations = d.getAnimations({subtree:true})
    animations.forEach(a => { a.pause(); a.currentTime = 110 })
    return { open:d.open, durations:animations.map(a=>a.effect.getTiming().duration), opacity:getComputedStyle(d).opacity, transform:getComputedStyle(d).transform }
  })
  assert.equal(enter.open, true); assert.ok(enter.durations.length >= 2); assert.ok(enter.durations.every(d=>d===220)); assert.ok(Number(enter.opacity)>0 && Number(enter.opacity)<1)
  await shot('market-motion-enter'); await dialog().evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>a.finish()))
  const leave = await dialog().evaluate(async el => {
    el.querySelector('[aria-label="关闭插件详情"]').click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    const animations=el.getAnimations({subtree:true}); animations.forEach(a=>{a.pause();a.currentTime=70})
    return { open:el.open, title:el.querySelector('h3').textContent, durations:animations.map(a=>a.effect.getTiming().duration), opacity:getComputedStyle(el).opacity }
  })
  assert.equal(leave.open,true); assert.ok(leave.title); assert.ok(leave.durations.length>=2); assert.ok(leave.durations.every(d=>d===140)); assert.ok(Number(leave.opacity)>0 && Number(leave.opacity)<1)
  await shot('market-motion-leave'); await dialog().evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>a.finish())); await dialog().waitFor({state:'hidden'})
  const pageMotion = await page.getByTestId('plugins-nav-personal').evaluate(async el=>{
    el.click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
    return [...document.querySelector('.plugin-content').children].map(child=>({inert:child.inert,classes:child.className,transition:getComputedStyle(child).transitionDuration}))
  })
  assert.ok(pageMotion.some(p=>p.inert && p.classes.includes('leave'))); assert.ok(pageMotion.some(p=>p.classes.includes('enter') && p.transition.includes('0.22s')))
  await page.getByTestId('plugins-nav-market').click(); await count(10)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await ui().locator('.catalog-item').first().click(); await dialog().waitFor()
  assert.equal(await dialog().evaluate(el=>getComputedStyle(el).animationDuration),'0s')
  await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'})
  checks.push('Real 220ms entry / 140ms exit with retained modal content and backdrop; subpage fade/6px slide keeps hidden views inert; reduced motion is 0ms')
  await shot('market-light'); checks.push('Opening market automatically queries real catalog and separates installed content')
  await ui().getByRole('button',{ name:'官方', exact:true }).click(); await count(4)
  await ui().getByRole('button',{ name:'全部来源', exact:true }).click(); await count(10)
  await ui().getByRole('button',{ name:'题材', exact:true }).click(); await count(1)
  await ui().getByRole('button',{ name:'世界设定', exact:true }).click(); await count(1)
  const filtered = await ui().locator('.catalog').evaluate(el=>({width:el.clientWidth,gap:parseFloat(getComputedStyle(el).columnGap),cardWidth:el.firstElementChild.getBoundingClientRect().width}))
  // Filtering may remove the vertical scrollbar and slightly widen the container.
  assert.ok(Math.abs(filtered.cardWidth - (filtered.width - (layouts[0].columns - 1) * filtered.gap) / layouts[0].columns) < 1, 'A single filtered result keeps one column instead of stretching across the catalog')
  const first = ui().locator('.catalog-item').first(); await first.focus(); await page.keyboard.press('Enter'); await page.getByTestId('market-detail').waitFor()
  assert.equal(await ui().locator('h3[tabindex]').evaluate(el => el === document.activeElement), true)
  assert.equal(await dialog().evaluate(el => el.matches(':modal')), true)
  assert.equal(await ui().locator('.catalog-item').count(), 1, 'The underlying filtered catalog stays mounted')
  await ui().getByLabel('市场关键词').evaluate(el => el.focus())
  assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true, 'Native modal prevents background focus')
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true) }
  await dialog().getByRole('button', {name:'关闭插件详情'}).focus(); await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true)
  await ui().locator('h3[tabindex]').focus(); await shot('market-detail-light')
  await ui().getByRole('button',{ name:'关闭插件详情', exact:true }).click(); await dialog().waitFor({state:'hidden'}); await count(1)
  assert.equal(await first.evaluate(el => el === document.activeElement), true)
  assert.equal(await ui().getByRole('button',{ name:'题材', exact:true }).getAttribute('aria-pressed'), 'true')
  checks.push('Official/community provenance, multi-category AND filter, keyboard details and restored focus/filter')
  await ui().getByRole('button',{name:'清空筛选',exact:true}).click(); await count(10)
  await ui().getByText('更多筛选',{exact:true}).click(); await ui().getByLabel('标签',{exact:true}).fill('仙侠'); await ui().getByRole('button',{name:'应用筛选',exact:true}).click(); await count(1)
  await ui().getByRole('button',{name:'清空筛选',exact:true}).click(); await count(10)
  await ui().getByLabel('扩展分类',{exact:true}).fill('custom.reference'); await ui().getByRole('button',{name:'应用筛选',exact:true}).click(); await count(1)
  assert.match(await ui().locator('.catalog-item').innerText(),/扩展分类示例/)
  await ui().getByRole('button',{name:'清空筛选',exact:true}).click(); await count(10); await ui().getByText('更多筛选',{exact:true}).click()
  checks.push('Collapsed advanced filters preserve tag and custom-category discovery')
  await ui().getByRole('button',{name:'下一页',exact:true}).click(); await count(2); await fit()
  await ui().getByRole('button',{name:'上一页',exact:true}).click(); await count(10)
  const lastCard = ui().locator('.catalog-item').last(); await lastCard.focus(); const scrollBefore = await page.locator('.settings-editor').evaluate(el => el.scrollTop); await page.keyboard.press('Enter'); await page.getByTestId('market-detail').waitFor()
  await count(10); await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'}); await count(10)
  assert.equal(await page.locator('.settings-editor').evaluate(el => el.scrollTop), scrollBefore)
  assert.equal(await lastCard.evaluate(el=>el===document.activeElement),true)
  const returned = await lastCard.boundingBox(); assert.ok(returned && returned.y < await page.evaluate(()=>innerHeight) && returned.y+returned.height > 0)
  checks.push('Returning from a lower catalog item restores both keyboard focus and its visible scroll position')
  const input = ui().getByLabel('市场关键词'); await input.fill('仙侠')
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  assert.equal(await ui().getByRole('button',{name:'查找插件',exact:true}).isDisabled(),true)
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))); await input.press('Enter'); await count(1)
  await input.fill('无此插件'); await input.press('Enter'); await count(0); await shot('market-empty')
  await ui().getByRole('button',{name:'查看全部插件',exact:true}).click(); await count(10)
  failCatalog = true; await input.fill('仙侠'); await input.press('Enter'); await ui().getByRole('alert').waitFor(); await count(10)
  assert.match(await ui().getByRole('alert').innerText(),/已保留/); assert.match(await ui().locator('.results-heading').innerText(),/全部插件/)
  await shot('market-error'); failCatalog = false; await ui().getByRole('button',{name:'重试',exact:true}).click(); await count(1)
  checks.push('Previous/next page, IME submit guard, empty result, failed query retains labelled prior results and retry recovers')
  const heldVersions = holdNext('/versions'); await first.click(); await heldVersions.started; await dialog().waitFor()
  await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'}); heldVersions.release(); await count(1)
  assert.equal(await dialog().isVisible(), false, 'Late versions never reopen a dismissed dialog')
  await first.click(); await dialog().waitFor(); failDownload = true
  await dialog().getByRole('button',{name:'下载并预览安装',exact:true}).click(); await dialog().getByRole('alert').waitFor(); await shot('market-detail-error')
  failDownload = false; await dialog().getByRole('button',{name:'重试',exact:true}).click(); await count(1)
  const heldDownload = holdNext('/download/'); await dialog().getByRole('button',{name:'下载并预览安装',exact:true}).click(); await heldDownload.started
  await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'}); heldDownload.release(); await count(1)
  assert.equal(await page.getByTestId('plugin-preview').isVisible(), false, 'Late download never opens an installation preview after dismissal')
  checks.push('Native modal traps focus; Escape dismisses pending versions/download; late replies stay dismissed and errors remain inside dialog')
  await first.click(); await dialog().waitFor(); await dialog().getByRole('button',{name:'下载并预览安装',exact:true}).click()
  await page.getByTestId('plugin-preview').waitFor(); assert.equal(await dialog().evaluate(el => el.open), false); await page.getByTestId('plugin-preview').getByRole('button',{name:'取消',exact:true}).click(); await page.getByTestId('market-detail').waitFor()
  await ui().getByRole('button',{name:'下载并预览安装',exact:true}).click(); await page.getByTestId('plugin-install').click()
  await dialog().waitFor({state:'hidden'})
  const installed = page.locator('[data-plugin-id="test.market-ui.p0"]'); await installed.waitFor()
  const actual = await page.evaluate(()=>window.novelDesktop.writingPlugins.list(true)); assert.equal(actual.plugins.length,1); assert.equal(actual.plugins[0].enabled,false); assert.deepEqual(actual.plugins[0].versions[0].grants,[])
  checks.push('Real ZIP download/preview cancel returns to detail; explicit install navigates to installed and remains disabled/ungranted')
  await page.getByTestId('plugins-nav-market').click(); await page.getByTestId('market-detail').waitFor(); await ui().getByRole('button',{name:'关闭插件详情',exact:true}).click(); await ui().getByRole('button',{name:'清空筛选',exact:true}).click(); await count(10)
  const nativeWindow = await app.browserWindow(page)
  const compact = await nativeWindow.evaluate(async w => { w.unmaximize(); for(let n=0;n<20 && w.isMaximized();n++) await new Promise(r=>setTimeout(r,100)); const [mw,mh]=w.getMinimumSize(); const width=Math.max(mw,1100), height=Math.max(mh,800); w.setSize(width,height); return {width,height} })
  await page.waitForFunction(width=>innerWidth <= width, compact.width); await shot('market-compact')
  await ui().getByRole('button',{name:'下一页',exact:true}).click(); await count(2)
  await ui().locator('.catalog-item').last().click(); await dialog().waitFor(); await count(2)
  const longBounds = await dialog().evaluate(el => { const box = el.getBoundingClientRect(), close = el.querySelector('.detail-close').getBoundingClientRect(); return {fit:box.top >= 0 && box.bottom <= innerHeight && box.width <= innerWidth, closeVisible:close.top >= box.top && close.bottom <= box.bottom, noOverflow:el.scrollWidth <= el.clientWidth + 1, scrollable:el.querySelector('.detail-scroll').scrollHeight > el.querySelector('.detail-scroll').clientHeight} })
  assert.deepEqual(longBounds, {fit:true,closeVisible:true,noOverflow:true,scrollable:true})
  assert.equal(await dialog().locator('h3').innerText(), fixtures[11][0])
  assert.equal(await dialog().locator('.description').innerText(), fixtures[11][2])
  await shot('market-detail-long');
  const backgroundScroll = await page.locator('.settings-editor').evaluate(el => el.scrollTop); await dialog().locator('.detail-scroll').evaluate(el => { el.scrollTop = el.scrollHeight });
  assert.equal(await page.locator('.settings-editor').evaluate(el => el.scrollTop), backgroundScroll);
  assert.ok(await dialog().locator('.detail-scroll').evaluate(el => el.scrollTop > 0)); await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'}); await ui().getByRole('button',{name:'上一页',exact:true}).click(); await count(10)
  checks.push('Long titles and full descriptions remain readable in a scrollable compact modal with a visible close button')
  await ui().locator('.catalog-item').first().click(); await page.getByTestId('market-detail').waitFor(); await shot('market-detail-compact'); await ui().getByRole('button',{name:'关闭插件详情',exact:true}).click()
  await page.getByTestId('settings-category-common').click(); await page.getByTestId('settings-nav-appearance').click(); await page.getByTestId('theme-moye').check(); await page.getByTestId('settings-category-writing').click(); await page.getByTestId('settings-nav-plugins').click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="plugin-library"] .catalog-item').length === 8); await page.getByTestId('plugins-nav-market').click(); await count(10); await shot('market-dark')
  await ui().locator('.catalog-item').first().click(); await dialog().waitFor(); await count(10); await shot('market-detail-dark'); await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'})
  await page.getByTestId('plugins-nav-personal').click(); await page.getByTestId('personal-plugins').waitFor(); await shot('personal-dark')
  checks.push('Default and compact native windows, dark theme, details and personal navigation fit all ancestors')
  // Publish a second real package only after the original catalog/layout checks.
  const updatedZip = await JSZip.loadAsync(fixturePackages[0]), updatedManifest = JSON.parse(await updatedZip.file('lanjian-plugin.json').async('string'))
  updatedManifest.version = '2.0.0'; updatedManifest.description = '新版仙侠指导，核对版本定位。'
  updatedZip.file('lanjian-plugin.json', JSON.stringify(updatedManifest))
  const updatedBytes = await updatedZip.generateAsync({ type: 'nodebuffer' }), updatedPackage = await readPluginPackage(updatedBytes), updateId = randomUUID()
  const preparedUpdate = market.catalog.prepare(official, { operationId: updateId, manifest: updatedPackage.manifest, digest: createHash('sha256').update(updatedBytes).digest('hex'), bytes: updatedBytes.length, upstream: null })
  assert.equal((await market.service.commit(updateId, official, preparedUpdate.ticket, updatedBytes)).state, 'published')
  await page.getByTestId('plugins-nav-market').click(); await ui().locator('.catalog-item').filter({ hasText: '仙侠世界构筑' }).first().click(); await dialog().waitFor()
  await dialog().getByRole('combobox', { name: /^公开版本/ }).selectOption({ label: '2.0.0' })
  await dialog().getByRole('button', { name: '下载并预览安装', exact: true }).click(); await page.getByTestId('plugin-install').click()
  await page.waitForFunction(() => document.querySelector('[data-testid="writing-plugin-settings"]')?.getAttribute('aria-busy') === 'false')
  assert.equal(await installed.locator('select option:checked').innerText(), '2.0.0')
  await installed.getByRole('button', { name: '确认切换版本', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="writing-plugin-settings"]')?.getAttribute('aria-busy') === 'false')
  const beforeManage = await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))
  assert.equal(beforeManage.plugins[0].versions.find(v => v.digest === beforeManage.plugins[0].current).manifest.version, '2.0.0')
  assert.equal(beforeManage.plugins[0].enabled, false)
  await page.getByRole('button', { name: '我创建的', exact: true }).click(); await page.getByLabel('查找插件', { exact: true }).fill('隐藏已安装版本')
  await page.getByTestId('plugins-nav-market').click(); await dialog().waitFor()
  await dialog().getByRole('combobox', { name: /^公开版本/ }).selectOption({ label: '1.0.0' })
  await dialog().getByRole('button', { name: '管理已安装', exact: true }).click()
  await installed.locator('.plugin-editor').waitFor()
  assert.equal(await installed.locator('select option:checked').innerText(), '1.0.0')
  assert.match(await installed.getByLabel('版本切换核对').innerText(), /当前 2.0.0 → 待切换 1.0.0/)
  assert.equal(await installed.evaluate(el => el === document.activeElement), true)
  assert.equal(await page.getByLabel('查找插件', { exact: true }).inputValue(), '')
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins, beforeManage.plugins)
  await fit(); await page.screenshot({ path: join(evidence, 'market-manage-selected-version.png') }); screenshots.push('market-manage-selected-version')
  await installed.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.writingPlugins.list(true))).plugins, beforeManage.plugins)
  checks.push('Real public update opens exact installed version; managing the older detail preselects that digest, clears filters and preserves current/disabled state on cancel')
  await page.getByTestId('plugins-nav-market').click(); await ui().locator('.catalog-item').filter({ hasText: '仙侠世界构筑' }).first().click(); await dialog().getByRole('button', { name: '管理已安装', exact: true }).waitFor()
  // Simulate another authorized client uninstalling while this catalog is stale.
  await page.evaluate(async () => { const api = window.novelDesktop.writingPlugins, latest = await api.list(true); await api.uninstall({ id: 'test.market-ui.p0', revision: latest.revision }) })
  await dialog().getByRole('button', { name: '管理已安装', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '这个插件版本已不在本机' }).waitFor()
  assert.equal(await installed.count(), 0)
  assert.equal(await page.locator('.installed-plugins .plugin-editor').count(), 0)
  checks.push('Stale installed detail rechecks main state and reports missing version without selecting a fallback or reinstalling')
  await app.close(); app=undefined; await launch(false); await ui().getByText('公共市场尚未连接',{exact:true}).waitFor(); await shot('market-disconnected'); assert.equal(await ui().locator('.catalog-item').count(),0)
  await ui().getByRole('button',{name:'创建我的插件',exact:true}).click(); await page.getByTestId('personal-plugins').waitFor(); await shot('personal-light')
  checks.push('Unconfigured build truthfully shows disconnected state and working offline authoring entry')
  assert.deepEqual(errors,[])
  const report={ok:true,checks,requests,screenshots,layouts,errors,fixtures:'Synthetic plugins in isolated real HTTP service, not production listings; no authentication in this UI test'}
  await writeFile(join(evidence,'results.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2))
} catch(error) {
  await page?.screenshot({path:join(evidence,`failure-${Date.now()}.png`)}).catch(()=>{})
  await writeFile(join(evidence,`failure-${Date.now()}.json`),JSON.stringify({error:String(error),checks,errors,viewport:await page?.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})).catch(()=>null),body:await page?.locator('body').innerText().catch(()=>null)},null,2)); throw error
} finally {
  for (const release of releaseHolds) release()
  clearTimeout(watchdog); if(app) await app.close().catch(()=>{}); await market.app.close()
  const checked=await realpath(root); if(dirname(checked)!==parent || !basename(checked).startsWith('lanjian-market-ui-')) throw new Error('Refusing cleanup outside owned UI fixture')
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
