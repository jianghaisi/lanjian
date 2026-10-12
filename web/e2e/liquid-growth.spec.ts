// Historical opening retired from homepage on 2026-10-11.
import { test, expect } from '@playwright/test'

test.skip('WELCOME grows the visible figure before retreat and replay resets it', async ({ page }) => {
  // Retain the test framebuffer so readPixels measures actual shader alpha.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      return Reflect.apply(original, this, [kind, kind === 'webgl' ? { ...(options as object), preserveDrawingBuffer: true } : options])
    } as typeof original
  })
  await page.goto('/')
  const canvas = page.locator('.glass-person .glass-surface canvas')
  await expect(page.locator('.glass-person .glass-surface')).toHaveAttribute('data-renderer', 'webgl')
  await expect(canvas).toHaveAttribute('data-growth', '0.000')
  const coverage = () => canvas.evaluate(el => {
    const c = el as HTMLCanvasElement, gl = c.getContext('webgl')!
    const pixels = new Uint8Array(c.width * c.height * 4)
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let visible = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 16) visible++
    return visible / (c.width * c.height)
  })
  expect(await coverage()).toBe(0)
  await page.getByRole('button', { name: 'WELCOME', exact: true }).click()
  await expect.poll(() => canvas.getAttribute('data-growth').then(Number)).toBeGreaterThan(0.12)
  const assertCentred = async () => {
    const box = await page.locator('.glass-person').boundingBox()
    const width = await page.evaluate(() => innerWidth)
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(3)
  }
  await assertCentred()
  const firstCamera = await page.locator('.glass-camera').evaluate(el => getComputedStyle(el).transform)
  const early = await coverage()
  await page.screenshot({ path: 'test-results/liquid-growth-early.png' })
  await expect.poll(() => canvas.getAttribute('data-growth').then(Number)).toBeGreaterThan(0.5)
  await assertCentred()
  const middle = await coverage()
  await page.screenshot({ path: 'test-results/liquid-growth-middle.png' })
  await expect.poll(() => canvas.getAttribute('data-growth').then(Number)).toBeGreaterThan(0.96)
  await assertCentred()
  const lastCamera = await page.locator('.glass-camera').evaluate(el => getComputedStyle(el).transform)
  expect(lastCamera).not.toBe(firstCamera)
  const grown = await coverage()
  expect(middle).toBeGreaterThan(early)
  expect(grown).toBeGreaterThan(middle)
  expect(grown).toBeGreaterThan(early * 3)
  await page.screenshot({ path: 'test-results/liquid-growth-complete.png' })
  await expect(page.locator('.archive-hero')).toHaveAttribute('data-phase', 'entered')
  await page.getByRole('button', { name: '重播开场' }).click()
  await expect(canvas).toHaveAttribute('data-growth', '0.000')
  expect(await coverage()).toBe(0)
})
