import { test, expect } from '@playwright/test'

test('product homepage presents real tools and fits desktop without an opening screen', async ({page}) => {
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => requests.push(r.url()))
  await page.goto('/')
  await expect(page.getByRole('link',{name:'开始创作'})).toHaveAttribute('href','/login')
  await expect.poll(() => page.locator('.workspace-frame img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  await page.getByRole('button',{name:'作品书库',exact:true}).click()
  await expect(page.locator('.workspace-frame img')).toHaveAttribute('alt',/作品书库/)
  await page.getByRole('button',{name:'正文编辑',exact:true}).click()
  for (const size of [{width:1440,height:900},{width:1366,height:768},{width:1280,height:720},{width:1024,height:768},{width:390,height:844}]) {
    await page.setViewportSize(size)
    for (const label of ['01 关于岚笺','02 创作流程','03 完整参考书','04 桌面版本']) {
      await page.getByRole('tab',{name:label}).click()
      await page.waitForTimeout(600)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if(size.width>760) {
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
        const footer = await page.locator('.product-footer').boundingBox()
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(size.height + 1)
        const stage = await page.locator('.product-stage').boundingBox()
        expect(stage!.y + stage!.height).toBeLessThanOrEqual(footer!.y + 1)
      }
      await page.screenshot({path:`test-results/product-${size.width}-${label.slice(0,2)}.png`,fullPage:true})
    }
  }
  await page.getByRole('tab',{name:'02 创作流程'}).click()
  await page.getByRole('tab',{name:/把因果串成一条线/}).click()
  await expect(page.locator('#product-stage-detail')).toContainText('时间、人物、地点和结果')
  await page.getByRole('tab',{name:/把因果串成一条线/}).press('ArrowDown')
  await expect(page.getByRole('tab',{name:/一章一章地展开/})).toBeFocused()
  await expect(page.locator('.archive-hero,.glass-surface,.prologue-arms')).toHaveCount(0)
  expect(requests.filter(url => /glass-arm|glass-person/.test(url))).toEqual([])
  expect(errors).toEqual([])
})
