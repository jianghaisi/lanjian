import { test, expect, type Page } from '@playwright/test'

const referral = 'https://www.fastaitoken.com/register?aff=YD326MA7UYAU'
async function enter(page: Page) {
  const button = page.getByTestId('app-boot-enter')
  const direct = page.getByRole('button', { name: /直接进入/ })
  await expect(button.or(direct).or(page.getByTestId('project-library')).or(page.getByLabel('章节标题'))).not.toHaveCount(0, { timeout: 60000 })
  if (await direct.isVisible()) await direct.click()
  else if (await button.isVisible()) await button.click()
  await expect(page.getByTestId('app-boot')).not.toBeVisible({ timeout: 60000 })
  await expect(page.getByTestId('workspace-loading')).not.toBeVisible({ timeout: 60000 })
}

test('portal sponsor opens accessibly on desktop and mobile, preserving referral in a new tab', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // Capture the real browser target without contacting or registering with the sponsor.
  await context.route('https://www.fastaitoken.com/**', route => route.fulfill({ body: 'External target captured by isolated test.' }))
  await page.goto('/')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const trigger = page.getByRole('button', { name: '赞助商 · FastAIToken ↗' })
    await trigger.focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: '支持岚笺的伙伴' })
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.getByAltText('FastAIToken Logo').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true)
    await expect(page.getByRole('button', { name: '关闭赞助介绍' })).toBeFocused()
    expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
    const link = dialog.getByRole('link', { name: /通过岚笺邀请链接注册/ })
    const popupPromise = context.waitForEvent('page')
    await link.click()
    const popup = await popupPromise; await popup.waitForURL(referral)
    expect(await popup.evaluate(() => window.opener === null)).toBe(true)
    await popup.close()
    await page.screenshot({ path: `test-results/sponsor-portal-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused()
  }
  expect(errors).toEqual([])
})

test('hosted library exposes sponsor without a book or personal model configuration', async ({ page }) => {
  const started = await page.request.get('/api/auth/linuxdo/start', { maxRedirects: 0 })
  const callback = new URL(started.headers().location!); callback.searchParams.set('code', '326')
  await page.request.get(callback.href)
  await page.goto('/app'); await enter(page)
  await expect(page.getByTestId('project-library')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('library-settings-sponsors').click()
  const dialog = page.locator('dialog.library-preferences-dialog')
  await expect(dialog.getByTestId('sponsor-card')).toBeVisible()
  await expect.poll(() => dialog.getByAltText('FastAIToken Logo').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true)
  await expect(dialog.getByRole('link', { name: /通过岚笺邀请链接注册/ })).toHaveAttribute('href', referral)
  await expect(page.getByTestId('library-global-models')).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await dialog.locator('.library-settings-content').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: `test-results/sponsor-library-${width}.png` })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('hosted work about page includes sponsor while model configuration remains hidden', async ({ page }) => {
  await page.goto('/app?guest=1'); await enter(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('settings-category-advanced').click()
  await page.getByTestId('settings-nav-about').click()
  await expect(page.locator('.about-lanjian').getByTestId('sponsor-card')).toBeVisible()
  await page.getByTestId('settings-category-ai').click()
  await expect(page.getByTestId('settings-nav-connection')).toHaveCount(0)
})
