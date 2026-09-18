import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electron = process.env.ELECTRON_EXECUTABLE_PATH || require('electron')
const { _electron } = process.env.PLAYWRIGHT_MODULE_PATH
  ? require(process.env.PLAYWRIGHT_MODULE_PATH)
  : require('playwright')

const userData = await mkdtemp(join(tmpdir(), 'lanjian-workspace-navigation-'))
const projectParent = await mkdtemp(join(tmpdir(), 'lanjian-workspace-project-'))
const output = resolve('../.trellis/tasks/09-09-v3-workspace-navigation-hierarchy/evidence/screenshots')
await mkdir(output, { recursive: true })
const launchEnv = { ...process.env, LANJIAN_USER_DATA_PATH: userData }
delete launchEnv.ELECTRON_RUN_AS_NODE

const app = await _electron.launch({ executablePath: electron, args: ['.'], env: launchEnv, timeout: 30000 })
const page = await app.firstWindow()
page.setDefaultTimeout(30000)
const pageErrors = []
let darkLibraryStyles
const viewportChecks = []
page.on('pageerror', error => pageErrors.push(error.message))

const click = selector => page.locator(selector).first().click()
const capture = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(output, `${name}.png`) })
}
const visibleText = selector => page.locator(selector).allTextContents()
const setInput = async (selector, value) => page.locator(selector).evaluate((input, next) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
const assertLibraryChromeReadable = async label => {
  const failures = await page.evaluate(() => {
    const parseColor = value => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? []
      return channels.length >= 3 ? { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 } : undefined
    }
    const luminance = color => {
      const channel = value => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }
    const contrast = (foreground, background) => {
      const first = luminance(foreground)
      const second = luminance(background)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }
    const topbarBackground = parseColor(getComputedStyle(document.querySelector('.library-topbar')).backgroundColor)
    const targets = ['.brand-archive-mark', '.brand-wordmark', '.brand-latin', '.local-status', '.topbar-settings']
    const result = []
    for (const selector of targets) {
      const node = document.querySelector(selector)
      const foreground = parseColor(getComputedStyle(node).color)
      const ratio = contrast(foreground, topbarBackground)
      if (ratio < 4.5) result.push({ selector, foreground: getComputedStyle(node).color, ratio: Number(ratio.toFixed(2)) })
    }
    const input = document.querySelector('.library-search input')
    const inputStyle = getComputedStyle(input)
    const inputBackground = parseColor(inputStyle.backgroundColor)
    const effectiveBackground = inputBackground?.a >= 0.98 ? inputBackground : topbarBackground
    for (const [selector, color] of [['.library-search input', inputStyle.color], ['.library-search input::placeholder', getComputedStyle(input, '::placeholder').color]]) {
      const ratio = contrast(parseColor(color), effectiveBackground)
      if (ratio < 4.5) result.push({ selector, foreground: color, ratio: Number(ratio.toFixed(2)) })
    }
    return result
  })
  assert.deepEqual(failures, [], `${label} contains unreadable library chrome: ${JSON.stringify(failures)}`)
}
const assertReadableActions = async label => {
  const failures = await page.evaluate(() => {
    const actionSelector = [
      'button.control-button.primary:not(:disabled)',
      'button.ink-action:not(:disabled)',
      'button.seal-action:not(:disabled)',
      'button.save-action:not(:disabled)',
      'button.archive-action.dark:not(:disabled)',
      'button.archive-action.orange:not(:disabled)',
      '.assistant-mode-switch button.active:not(:disabled)'
    ].join(',')
    const parseColors = value => [...value.matchAll(/rgba?\(([^)]+)\)/g)].map(match => {
      const channels = match[1].match(/[\d.]+/g)?.map(Number) ?? []
      return channels.length >= 3 ? { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 } : undefined
    }).filter(Boolean)
    const luminance = color => {
      const channel = value => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }
    const contrast = (foreground, background) => {
      const first = luminance(foreground)
      const second = luminance(background)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }
    const result = []
    for (const action of document.querySelectorAll(actionSelector)) {
      if (!action.checkVisibility()) continue
      const actionStyle = getComputedStyle(action)
      const backgrounds = [
        ...parseColors(actionStyle.backgroundColor).filter(color => color.a >= 0.98),
        ...parseColors(actionStyle.backgroundImage).filter(color => color.a >= 0.98)
      ].filter((color, index, all) => all.findIndex(candidate => candidate.r === color.r && candidate.g === color.g && candidate.b === color.b) === index)
      if (!backgrounds.length) continue
      const textNodes = [action, ...action.querySelectorAll('span,strong,b,small,em')]
      for (const textNode of textNodes) {
        if (!textNode.textContent?.trim() || !textNode.checkVisibility()) continue
        const foreground = parseColors(getComputedStyle(textNode).color)[0]
        if (!foreground) continue
        const minimum = Math.min(...backgrounds.map(background => contrast(foreground, background)))
        if (minimum < 4.5) {
          result.push({
            action: action.getAttribute('data-testid') || action.className,
            text: textNode.textContent.trim().slice(0, 48),
            foreground: getComputedStyle(textNode).color,
            background: `${actionStyle.backgroundColor} ${actionStyle.backgroundImage}`,
            ratio: Number(minimum.toFixed(2))
          })
        }
      }
    }
    return result
  })
  assert.deepEqual(failures, [], `${label} contains unreadable primary action text: ${JSON.stringify(failures)}`)
}

try {
  await page.waitForFunction(() => Boolean(window.novelDesktop))
  await page.evaluate(() => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    localStorage.setItem('lanjian-theme', 'qingzhou')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
  })
  await page.reload()
  await page.locator('.project-library').waitFor()

  assert.match(await page.locator('[data-testid="create-work-item"]').textContent(), /新建空白作品/)
  assert.match(await page.locator('[data-testid="library-import-project"]').textContent(), /导入作品/)
  assert.equal(await page.locator('[data-testid="create-from-txt"]').count(), 0)
  assert.equal(await page.locator('[data-testid="create-work-item"]').evaluate(node => node.classList.contains('orange')), true)
  await assertLibraryChromeReadable('library')
  await assertReadableActions('library')
  await capture('01-library-three-entries')

  await click('[data-testid="create-work-item"]')
  await page.locator('.create-book-modal').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.create-book-modal').count(), 0)
  assert.equal(await page.locator('[data-testid="create-work-item"]').evaluate(node => node === document.activeElement), true)
  await page.keyboard.press('Enter')
  await page.locator('.create-book-modal').waitFor()
  await page.locator('.create-book-modal button[type="submit"], .create-book-modal footer .control-button.primary').click()
  assert.equal(await page.locator('#create-name-error').isVisible(), true)
  assert.equal(await page.locator('#create-path-error').isVisible(), true)
  assert.equal(await page.locator('input[placeholder="例如：灯火照长安"]').evaluate(node => node === document.activeElement), true)
  await assertReadableActions('create dialog')
  await capture('02-create-inline-validation')

  await page.locator('input[placeholder="例如：灯火照长安"]').fill('导航验收书稿')
  await setInput('input[placeholder="选择本地文件夹"]', projectParent)
  await page.locator('.create-book-modal footer .control-button.primary').click()
  await page.locator('[data-testid="new-project-guide"]').waitFor()
  const persistedProjects = await page.evaluate(() => window.novelDesktop.projects.list())
  assert.equal(persistedProjects.projects.some(project => project.title === '导航验收书稿' && project.path.endsWith('导航验收书稿')), true)
  assert.equal(await page.locator('[data-nav-parent="definition"]').getAttribute('aria-current'), 'step')
  assert.equal(await page.locator('[data-testid="workspace-parent-heading"]').textContent().then(text => text.includes('定义') && text.includes('作品定义')), true)
  assert.equal(await page.locator('[data-nav-leaf="profile"]').count(), 0, 'single-leaf definition must not repeat the page')
  await assertReadableActions('new project guidance')
  await capture('03-created-definition-guidance')

  const expectedParents = ['定义', '素材', '设定', '总纲', '纪事', '谋篇', '书稿', '设置']
  assert.deepEqual(await visibleText('.activitybar > button span'), expectedParents)
  assert.equal(await page.locator('.activitybar > button[aria-current]').count(), 1)

  await page.locator('[data-nav-parent="materials"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-nav-parent="materials"][aria-current="step"]').waitFor()
  await page.locator('[data-nav-parent="foundation"]').focus()
  await page.keyboard.press('Space')
  await page.locator('[data-nav-parent="foundation"][aria-current="step"]').waitFor()

  const leavesByParent = {
    materials: ['ideas', 'manual-sources', 'web-research', 'event-extraction'],
    foundation: ['characters', 'world', 'realms', 'system-template'],
    chronicle: ['event-timeline', 'world-map', 'foreshadows', 'character-lines'],
    planning: ['total-outline', 'volume-lines', 'chapter-skeleton', 'preparation'],
    manuscript: ['chapters', 'review']
  }

  for (const [parent, leaves] of Object.entries(leavesByParent)) {
    await click(`[data-nav-parent="${parent}"]`)
    await page.locator(`[data-nav-parent="${parent}"][aria-current]`).waitFor()
    const directory = parent === 'planning' ? '.planning-sidebar' : parent === 'chronicle' ? '.chronicle-sidebar' : '.section-navigation'
    assert.deepEqual(await page.locator(`${directory} [data-nav-leaf]`).evaluateAll(nodes => nodes.map(node => node.dataset.navLeaf)), leaves)
    for (const leaf of leaves) {
      await click(`[data-nav-leaf="${leaf}"]`)
      await page.locator(`[data-nav-leaf="${leaf}"][aria-current="page"]`).waitFor()
      assert.equal(await page.locator('.activitybar > button[aria-current]').count(), 1)
      assert.equal(await page.locator(`${directory} [aria-current="page"]`).count(), 1)
      assert.equal(await page.locator(`[data-nav-parent="${parent}"]`).getAttribute('aria-current'), 'step')
      await assertReadableActions(`${parent}/${leaf}`)
    }
  }

  await click('[data-nav-parent="foundation"]')
  await click('[data-nav-leaf="characters"]')
  assert.equal(await page.locator('.settings-category-navigation').count(), 0)
  assert.equal(await page.locator('.story-content-header').isVisible(), true)
  assert.equal(await page.locator('[data-nav-parent="settings"]').getAttribute('aria-current'), null)
  await capture('04-foundation-characters-no-settings-chrome')

  for (const [width, height, zoom, name] of [[1100, 760, 1, '05-workspace-1100x760'], [1440, 900, 1.25, '06-workspace-1440x900-125'], [1920, 1080, 1, '07-workspace-1920x1080']]) {
    await app.evaluate(({ BrowserWindow }, args) => {
      const window = BrowserWindow.getAllWindows().find(candidate => !candidate.webContents.getURL().includes('pet.html'))
      if (!window) throw new Error('Main workspace window was not found')
      if (window.isMaximized()) window.unmaximize()
      window.setContentSize(args.width, args.height)
      window.webContents.setZoomFactor(args.zoom)
    }, { width, height, zoom })
    await page.locator('.activitybar').hover()
    await page.waitForTimeout(250)
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      body: document.documentElement.scrollWidth,
      selectedParents: document.querySelectorAll('.activitybar > button[aria-current]').length,
      visibleParents: [...document.querySelectorAll('.activitybar > button')].every(node => node.checkVisibility()),
      labels: [...document.querySelectorAll('.activitybar > button span')].every(node => node.scrollWidth <= node.clientWidth + 1)
    }))
    assert.ok(geometry.body <= geometry.viewport, `${name} has horizontal overflow`)
    assert.equal(geometry.selectedParents, 1)
    assert.equal(geometry.visibleParents, true)
    assert.equal(geometry.labels, true)
    viewportChecks.push({ name, requested: { width, height, zoom }, actual: geometry })
    await capture(name)
  }

  await page.evaluate(() => localStorage.setItem('lanjian-theme', 'moye'))
  await page.reload()
  await page.locator('.project-library').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'moye')
  await assertLibraryChromeReadable('dark library')
  await assertReadableActions('dark library')
  darkLibraryStyles = await page.evaluate(() => {
    const styles = selector => {
      const computed = getComputedStyle(document.querySelector(selector))
      return { color: computed.color, backgroundColor: computed.backgroundColor }
    }
    const input = document.querySelector('.library-search input')
    return {
      topbar: styles('.library-topbar'),
      brandMark: styles('.brand-archive-mark'),
      brandWordmark: styles('.brand-wordmark'),
      brandLatin: styles('.brand-latin'),
      search: styles('.library-search input'),
      searchPlaceholder: getComputedStyle(input, '::placeholder').color,
      localStatus: styles('.local-status'),
      settings: styles('.topbar-settings')
    }
  })
  await capture('08-library-dark')

  assert.deepEqual(pageErrors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ ok: true, projectParent, pageErrors, darkLibraryStyles, viewportChecks, checks: ['three distinct library actions', 'library chrome and primary action text contrast in light/dark themes', 'inline validation and focus', 'created definition guidance', 'primary action text contrast across every workspace leaf', 'unique parent and leaf selection', 'all canonical leaves reachable', 'story content outside settings chrome', 'three viewport/zoom geometries', 'light and dark screenshots'] }, null, 2))
  console.log(JSON.stringify({ ok: true, output }))
} catch (error) {
  await capture('failure').catch(() => undefined)
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, pageErrors }, null, 2))
  throw error
} finally {
  await app.close()
}
