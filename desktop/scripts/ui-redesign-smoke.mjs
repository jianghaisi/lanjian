import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import electron from 'electron'

const require = createRequire(import.meta.url)
const { _electron } = process.env.PLAYWRIGHT_MODULE_PATH
  ? require(process.env.PLAYWRIGHT_MODULE_PATH)
  : require('playwright')
const userData = await mkdtemp(join(tmpdir(), 'lanjian-ui-redesign-'))
const output = resolve('artifacts/ui-redesign-verified')
await mkdir(output, { recursive: true })
const launchEnv = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: electron, args: ['.'], env: launchEnv, timeout: 30000 })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const results = []
const snapshot = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(output, `${name}.png`) })
}
const click = selector => page.locator(selector).first().click()
const openManuscriptHistory = async () => {
  await click('[data-testid="manuscript-view-menu"]')
  await page.locator('[data-testid="open-manuscript-history"]:visible').click()
}
async function checkGeometry(name) {
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector)
      if (!node?.checkVisibility()) return null
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    return { viewport: innerWidth, rail: rect('.activitybar'), tree: rect('.explorer'), work: rect('.workbench'), assistant: rect('.assistant-panel'), save: rect('[data-testid="save-manuscript"]'), body: document.documentElement.scrollWidth }
  })
  assert.ok(geometry.work && geometry.work.width > 300, `${name}: usable workspace ${JSON.stringify(geometry)}`)
  if (geometry.rail && geometry.tree) assert.ok(Math.abs(geometry.rail.right - geometry.tree.left) < 2, `${name}: navigation width differs from its grid track`)
  if (geometry.tree) assert.ok(geometry.tree.right <= geometry.work.left + 1, `${name}: tree overlaps editor`)
  if (geometry.assistant) assert.ok(geometry.work.right <= geometry.assistant.left + 1, `${name}: assistant overlaps editor`)
  if (geometry.save) assert.ok(geometry.save.right <= geometry.work.right + 1 && geometry.save.left >= geometry.work.left, `${name}: save clipped`)
  assert.ok(geometry.body <= geometry.viewport, `${name}: horizontal overflow`)
  results.push({ name, geometry })
}

try {
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => { localStorage.setItem('lanjian-opening-enabled', 'false'); sessionStorage.setItem('lanjian-opening-seen', 'true') })
  await page.reload()
  await page.locator('.library-heading').waitFor()
  await click('[data-activity="settings"]')
  await page.locator('.local-appearance-dialog[open]').waitFor()
  await page.locator('[data-testid="theme-moye"]').check()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'moye')
  await page.locator('[data-testid="theme-qingzhou"]').check()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.local-appearance-dialog[open]').count(), 0)
  await click('[data-testid="create-work-item"]')
  await snapshot('10-create-project')
  await page.locator('.modal-backdrop [aria-label="关闭"]').first().click()
  const seeded = await page.evaluate(async parentPath => {
    const api = window.novelDesktop
    for (const [name, genre] of [['长夜归舟', '奇幻'], ['杀死那个寄生虫', '科幻']]) {
      const { project } = await api.projects.create({ parentPath, name, genre })
      await api.projects.switch(project.path)
      const chapter = await api.chapters.create()
      await api.chapters.update(chapter.id, { title: '第一封来信', content: '这是独立的首页回归测试作品，归档不得改动这份正文。', expectedRevision: chapter.revision })
    }
    const { project } = await api.projects.create({ parentPath, name: '雨夜来信', genre: '都市', coreIdea: '每封旧信只能回答一个问题。' })
    await api.projects.switch(project.path)
    const chapter = await api.chapters.create()
    const content = '　　雨后的城门泛着冷光。沈砚循着断续的痕迹穿过长街，最后停在一扇没有灯的窗前。\n\n　　他从口袋里取出旧信，没有急着拆开。巷口传来最后一班车的声音，随后归于寂静。\n\n　　信上的日期比今天早了整整一年。沈砚抚平纸角，终于看清被水洇开的名字。'
    await api.chapters.update(chapter.id, { title: '雨后的城门', content, expectedRevision: chapter.revision })
    return { project, chapterId: chapter.id, content }
  }, userData)
  await page.reload()
  await page.locator('.work-item-open').first().waitFor()
  await snapshot('02-library')
  assert.equal(await page.locator('.library-sidebar nav button').count(), 3)
  assert.equal(await page.locator('[data-library-view="recent"]').count(), 0)
  assert.equal(await page.locator('.library-card-grid > li').count(), 3)
  assert.equal(await page.locator('.library-table').count(), 0)
  await page.getByRole('button', { name: '导入作品', exact: true }).click()
  await page.getByRole('button', { name: '打开岚笺作品', exact: true }).waitFor()
  await page.locator('[data-testid="library-import-project"]').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('#library-import-options').count(), 0)
  await page.locator('.work-item-menu-trigger').first().click()
  await page.locator('[data-testid="archive-work-item"]').click()
  assert.equal(await page.locator('.work-item-card').count(), 2)
  await page.locator('[data-library-view="archived"]').click()
  assert.equal(await page.locator('.work-item-card').count(), 1)
  await snapshot('02-library-archived')
  await page.reload()
  await page.locator('.library-heading').waitFor()
  await page.locator('[data-library-view="archived"]').click()
  assert.equal(await page.locator('.work-item-card').count(), 1)
  await page.locator('.work-item-menu-trigger').click()
  await page.locator('[data-testid="archive-work-item"]').click()
  await page.locator('[data-library-view="all"]').click()
  assert.equal(await page.locator('.work-item-card').count(), 3)
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), seeded.chapterId)).content, seeded.content)
  await click('[aria-label="关闭书架提示"]')
  await page.locator('.work-item-menu-trigger').first().click()
  await page.locator('[data-testid="trash-work-item"]').click()
  await page.locator('[data-testid="project-trash-confirmation"]').waitFor()
  assert.equal(await page.locator('[data-testid="confirm-trash-work-item"]').isDisabled(), true)
  await page.getByRole('button', { name: '继续保留', exact: true }).click()
  assert.equal(await page.locator('.work-item-card').count(), 3)
  for (const [width, height] of [[1586, 992], [1280, 800], [1100, 760]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
    await page.waitForFunction(w => Math.abs(innerWidth - w) <= 2, width)
    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector('.library-sidebar').getBoundingClientRect()
      const content = document.querySelector('.library-content')
      const cards = [...document.querySelectorAll('.library-card-grid > li')].map(card => {
        const r = card.getBoundingClientRect()
        const title = card.querySelector('.library-card-title').getBoundingClientRect()
        const cover = card.querySelector('.library-book-cover').getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, titleLeft: title.left, titleRight: title.right, coverRight: cover.right }
      })
      return { sidebarRight: sidebar.right, contentLeft: content.getBoundingClientRect().left, scroll: content.scrollWidth, width: content.clientWidth, cards, images: [...document.querySelectorAll('.library-book-cover img')].every(img => img.complete && img.naturalWidth > 0) }
    })
    assert.ok(layout.sidebarRight <= layout.contentLeft + 1)
    assert.ok(layout.scroll <= layout.width, JSON.stringify(layout))
    assert.ok(layout.images, 'local book cover asset renders')
    assert.ok(layout.cards.every(card => card.width >= 280 && card.titleLeft >= card.coverRight && card.titleRight <= card.right), 'card covers and text must fit without overlap')
    assert.ok(layout.cards.filter(card => Math.abs(card.top - layout.cards[0].top) < 2).length >= 2, 'works appear in multiple columns')
    assert.ok(layout.cards.every((card, i) => layout.cards.slice(i + 1).every(other => card.right <= other.left + 1 || other.right <= card.left + 1 || card.bottom <= other.top + 1 || other.bottom <= card.top + 1)), 'cards must not overlap')
    await page.locator('.work-item-menu-trigger').last().click()
    const menu = await page.locator('.library-card-menu').boundingBox()
    assert.ok(menu && menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= width + 2, 'last-card menu fits in viewport')
    assert.equal(await page.locator('.library-card-menu button').first().evaluate(button => {
      const r = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    }), true, 'menu remains clickable above neighboring cards')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.library-card-menu').count(), 0)
    assert.equal(await page.locator('.work-item-menu-trigger').last().evaluate(button => button === document.activeElement), true)
    results.push({ name: `${width}-library`, geometry: layout })
    await page.locator('.library-content').evaluate(node => { node.scrollTop = 0 })
    await page.mouse.move(0, 0)
    await snapshot(`02-library-${width}`)
  }
  await click('[data-activity="settings"]')
  await page.locator('[data-testid="theme-moye"]').check()
  await page.keyboard.press('Escape')
  await snapshot('02-library-moye')
  await click('[data-activity="settings"]')
  await page.locator('[data-testid="theme-qingzhou"]').check()
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('未命中')
  assert.equal(await page.locator('.work-item-card').count(), 0)
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('')
  await click('.work-item-open')
  await click('[data-activity="desk"]')
  await page.locator('[data-testid="manuscript-input"] .cm-line').first().waitFor()
  assert.deepEqual(await page.locator('.activitybar > button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label'))), ['作品', '资料', '谋篇', '写作', '设置'])
  await checkGeometry('1440-editor')
  await snapshot('03-manuscript-editor')
  const editor = page.locator('[data-testid="manuscript-input"]')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' UI regression saved.')
  await click('[data-testid="save-manuscript"]')
  const expectedContent = `${seeded.content} UI regression saved.`
  const deadline = Date.now() + 15000
  while ((await page.evaluate(id => window.novelDesktop.chapters.get(id), seeded.chapterId)).content !== expectedContent && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const saved = await page.evaluate(id => window.novelDesktop.chapters.get(id), seeded.chapterId)
  assert.equal(saved.content, expectedContent, 'native editing is persisted before navigation')
  await click('[data-activity="materials"]')
  for (const [id, shot, expected] of [['profile', 'book-definition', '.profile-grid'], ['world', 'world', '.longform'], ['realms', 'realms', '[data-testid="realm-config-page"]'], ['system', '07-system-template', '[data-testid="system-ui-config-page"]'], ['story', '06-knowledge', '[data-testid="settings-page-story"]']]) {
    await click(`.section-navigation [data-activity="${id}"]`)
    if (id !== 'story') await page.locator(expected).first().waitFor()
    await snapshot(shot)
  }
  await click('[data-activity="planning"]')
  await snapshot('04-outline-planner')
  await click('.section-navigation [data-activity="timeline"]')
  await snapshot('05-timeline')
  await click('.section-navigation [data-activity="preparation"]')
  await snapshot('preparation')
  await click('[data-activity="desk"]')
  await click('[data-testid="open-writing-guidance"]')
  await page.locator('[data-testid="assistant-check-page"]').waitFor()
  await snapshot('08-consistency-review')
  await click('[aria-label="关闭智能助笔侧栏"]')
  await click('[data-activity="settings"]')
  await click('[data-testid="settings-category-common"]')
  await click('[data-testid="settings-nav-appearance"]')
  await page.locator('[data-testid="theme-settings"]').waitFor()
  const preferences = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('lanjian-editor-'))))
  for (const theme of ['xuanzhi', 'moye', 'system', 'qingzhou']) {
    await page.locator(`[data-testid="theme-${theme}"]`).check()
    assert.equal(await page.evaluate(() => localStorage.getItem('lanjian-theme')), theme)
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('lanjian-editor-')))), preferences)
    await snapshot(`01-appearance-${theme}`)
    if (theme === 'system') {
      for (const [colorScheme, resolvedTheme] of [['dark', 'moye'], ['light', 'qingzhou']]) {
        await page.emulateMedia({ colorScheme })
        await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, resolvedTheme)
        assert.equal(await page.evaluate(() => localStorage.getItem('lanjian-theme')), 'system')
      }
    }
  }
  await page.locator('[data-testid="theme-moye"]').check()
  await click('[data-activity="desk"]')
  await snapshot('03-manuscript-moye')
  await click('[data-activity="materials"]')
  await snapshot('materials-moye')
  await click('.section-navigation [data-activity="system"]')
  await snapshot('system-moye')
  await click('[data-activity="planning"]')
  await snapshot('outline-moye')
  await click('[data-activity="desk"]')
  await click('[data-testid="open-writing-guidance"]')
  await page.locator('[data-testid="assistant-check-page"]').waitFor()
  await snapshot('review-moye')
  await click('[aria-label="关闭智能助笔侧栏"]')
  await click('[data-activity="desk"]')
  await click('[aria-controls="assistant-drawer"]')
  await page.locator('.assistant-panel').waitFor()
  await snapshot('assistant-moye')
  await click('[aria-controls="assistant-drawer"]')
  await openManuscriptHistory()
  await page.locator('.revision-ledger').waitFor()
  await snapshot('history-moye')
  await click('[aria-label="关闭历史版本"]')
  await page.reload()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'moye')
  if (await page.locator('.work-item-open').count()) await click('.work-item-open')
  await click('[data-activity="desk"]')
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), seeded.chapterId)).content, saved.content)
  await click('[data-activity="settings"]')
  await click('[data-testid="settings-category-common"]')
  await click('[data-testid="settings-nav-appearance"]')
  await page.locator('[data-testid="theme-qingzhou"]').check()
  await click('[data-activity="desk"]')
  await click('[aria-controls="assistant-drawer"]')
  await page.locator('.assistant-panel').waitFor()
  for (const [width, height] of [[1440, 900], [1280, 720], [1920, 1080], [1100, 800]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
    await page.waitForFunction(w => innerWidth === w, width)
    await checkGeometry(`${width}-assistant`)
    await snapshot(`09-assistant-${width}`)
  }
  await openManuscriptHistory()
  await page.locator('.revision-ledger').waitFor()
  await snapshot('history')
  const revisions = await page.evaluate(id => window.novelDesktop.chapters.revisions(id), seeded.chapterId)
  assert.ok(revisions.some(r => r.content === seeded.content), 'the version before editing remains in history')
  assert.equal((await page.evaluate(id => window.novelDesktop.chapters.get(id), seeded.chapterId)).content, saved.content, 'opening history leaves current content unchanged')
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, results, errors, checks: ['five destinations', 'library search and card grid without recent navigation', 'card menu bounds and Escape focus recovery', 'archive persistence and restore without content changes', 'separate import entries', 'trash confirmation and cancel', 'local cover assets', 'real save and reload', 'all feature routes', 'theme persistence and preference isolation', 'history preservation'] }, null, 2))
  console.log(JSON.stringify({ ok: true, captures: output, checks: results.length }))
} catch (error) {
  await snapshot('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, results }, null, 2))
  throw error
} finally {
  await app.close()
}
