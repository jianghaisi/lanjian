// Follow the main smoke with a genuine new Electron process and a second isolated work.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const output = resolve('../.trellis/tasks/09-18-v3-planning-directory-and-guidance/evidence')
const source = JSON.parse(await readFile(`${output}/result.json`, 'utf8'))
assert.ok(source.pass, 'Run planning-directory-smoke.mjs successfully first')
const env = { ...process.env, LANJIAN_USER_DATA_PATH: source.userData }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: require('electron'), args: [resolve('node_modules/.cache/planning-directory-build/out/main/index.js')], env })
const errors = []
let page
try {
  page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message))
  await page.getByTestId('app-boot').waitFor({ state: 'hidden' })
  await page.locator('.work-item-open').filter({ hasText: '谋篇验证（隔离样例）' }).click()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByRole('searchbox', { name: '搜索全部大纲' }).fill('第441章')
  await page.getByTestId('planning-chapter-900').waitFor()
  await page.getByTestId('planning-chapter-900').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="planning-chapter-900"][aria-current="page"]').waitFor()
  assert.match(await page.getByRole('textbox', { name: '当前章纲正文' }).innerText(), /保存重开/)
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.get(900))).content, '')

  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.getByTestId('create-work-item').first().click()
  await page.locator('input[placeholder="例如：灯火照长安"]').fill('空白对照作品')
  await page.locator('input[placeholder="选择本地文件夹"]').evaluate((input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }, source.parent)
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.getByTestId('new-project-guide').waitFor()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByRole('textbox', { name: '全局总纲正文' }).waitFor()
  assert.equal(await page.locator('[data-testid^="planning-volume-"]').count(), 0)
  assert.equal(await page.getByRole('searchbox', { name: '搜索全部大纲' }).inputValue(), '')
  assert.equal((await page.evaluate(() => window.novelDesktop.outlines.get('total'))).content, '')
  assert.equal((await page.evaluate(() => window.novelDesktop.chapters.list())).length, 0)
  await page.getByRole('button', { name: '返回我的作品', exact: true }).click()
  await page.locator('.work-item-open').filter({ hasText: '谋篇验证（隔离样例）' }).click()
  await page.locator('[data-nav-parent="planning"] svg').first().click()
  await page.getByTestId('planning-volume-1').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="planning-volume-1"][aria-current="page"]').waitFor()
  assert.match(await page.getByRole('textbox', { name: '当前卷纲正文' }).innerText(), /第一卷/)
  assert.deepEqual(errors, [])
  await writeFile(`${output}/restart-result.json`, JSON.stringify({ pass: true, checks: ['new Electron process reloads persisted chapter 900 at display position 441', 'keyboard opens exact documents', 'switch to a second empty work resets directory, query and draft; first work is unchanged'], errors }, null, 2))
  console.log('PASS: cold restart, stable ID/display position, keyboard and two-work isolation')
} catch (error) {
  await writeFile(`${output}/restart-result.json`, JSON.stringify({ pass: false, error: String(error), errors }, null, 2))
  if (page) await page.screenshot({ path: `${output}/restart-failure.png` })
  throw error
} finally { await app.close() }
