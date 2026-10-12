import { test, expect } from '@playwright/test'

test('public preview keeps login closed and the complete reference readable', async ({ page }) => {
  await page.route('**/api/site', route => route.fulfill({ json: { links: { project: '', download: '', guide: '' }, welcomePoints: 10, loginConfigured: false } }))
  for (const path of ['/app', '/admin']) {
    await page.goto(path)
    await expect(page.getByRole('status')).toContainText('登录暂未开放')
    await expect(page.getByRole('button', { name: '使用 Linux DO 登录' })).toHaveCount(0)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('link', { name: /以游客身份进入/ }).click()
  await page.getByTestId('app-boot-enter').click({ timeout: 60000 })
  await expect(page.getByLabel('章节标题')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.workspace-storage-status')).toContainText('只读')
})

test('configured login opens normally and failed readiness does not pretend to be disabled', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByRole('button', { name: '使用 Linux DO 登录' })).toBeVisible()
  await page.route('**/api/site', route => route.fulfill({ status: 503, json: { error: { code: 'configuration-required', message: '暂时无法读取' } } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('暂时无法读取')
  await expect(page.getByRole('button', { name: '使用 Linux DO 登录' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible()
})

test('a signed-in arrival can log out and immediately log in again', async ({ page }) => {
  const response = await page.request.get('/api/auth/linuxdo/start', { maxRedirects: 0 })
  const callback = new URL(response.headers().location!)
  callback.searchParams.set('code', '8181')
  await page.goto(callback.href)
  await expect(page.getByRole('heading', { name: '我的作品', exact: true })).toBeVisible()
  await page.getByTestId('app-boot-enter').click({ timeout: 60000 })
  await page.getByLabel('账户与参考书菜单').click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '使用 Linux DO 登录' })).toBeVisible()
})
