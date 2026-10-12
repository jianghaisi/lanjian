import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Runs only inside the runner's synthetic book/profile. Display overrides are
 * local to this test process; this is not physical multi-monitor/DPI coverage. */
export async function checkPetRecovery({ app, page, pet, profile, output, checks, observations, bounds }) {
  async function until(read, label) {
    for (let i = 0; i < 100; i++) { if (await read()) return; await pause(50) }
    throw new Error(`Timed out: ${label}`)
  }
  async function click(control) {
    await control.waitFor(); await pause(450)
    await control.scrollIntoViewIfNeeded()
    const native = await bounds(), rect = await control.boundingBox(), target = await control.getAttribute('data-testid')
    assert.ok(rect)
    // Deliver to the real Chromium window without fighting the author's mouse.
    // This exercises controls/IPC/native layout, not OS click-through hit testing.
    await app.evaluate(({ BrowserWindow }, point) => {
      const contents = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point })
    }, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) })
    observations.push({ case: 'recovery-electron-click', target, native, rect, after: await bounds() })
  }
  async function close() {
    await pet.getByTestId('pet-window-menu-toggle').press('Escape')
    await until(async () => (await pet.evaluate(() => window.desktopPet.get())).layout.kind === null, 'panel closed')
  }
  async function metrics() {
    const native = await bounds()
    return pet.evaluate(native => {
      const c = document.querySelector('[data-testid="pet-artwork"] canvas').getBoundingClientRect()
      const overlay = document.querySelector('[data-testid="pet-side-panel"]'), p = overlay?.getBoundingClientRect()
      return { native, canvas: { x: native.x + c.x, y: native.y + c.y, width: c.width, height: c.height },
        panel: p && { x: native.x + p.x, y: native.y + p.y, width: p.width, height: p.height },
        overflow: overlay ? overlay.scrollWidth > overlay.clientWidth + 1 : false }
    }, native)
  }
  const tools = page.getByTestId('desktop-pet-tools-toggle'), menu = page.getByTestId('desktop-pet-tools-menu')
  await tools.focus(); await page.keyboard.press('Enter'); await menu.waitFor()
  assert.equal(await page.getByTestId('desktop-pet-locate').evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('ArrowDown')
  assert.equal(await menu.getByRole('menuitem', { name: '关闭桌宠', exact: true }).evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('End')
  assert.equal(await menu.getByRole('menuitem', { name: '桌宠完整设置' }).evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp')
  assert.equal(await menu.getByRole('menuitem', { name: '桌宠完整设置' }).evaluate(e => e === document.activeElement), true)
  await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' })
  assert.equal(await tools.evaluate(e => e === document.activeElement), true)
  await tools.click(); await page.keyboard.press('Tab'); await menu.waitFor({ state: 'detached' })
  await page.getByTestId('external-companion').focus(); await page.keyboard.press('Shift+F10')
  await menu.waitFor(); await page.keyboard.press('Escape')
  await tools.click(); await page.mouse.click(10, 110); await menu.waitFor({ state: 'detached' })
  checks.push('tools menu supports Enter, arrows, Home/End, Escape focus return, Tab, legacy Shift+F10 and outside dismissal')

  const file = join(profile, 'desktop-pet.json'), original = await readFile(file, 'utf8')
  const beforeFailure = await bounds(), stateBeforeFailure = await page.evaluate(() => window.desktopPet.get())
  try {
    await writeFile(file, '{isolated invalid fixture}')
    await tools.click(); await page.getByTestId('desktop-pet-locate').click()
    await menu.getByRole('alert').waitFor()
    assert.match(await menu.getByRole('alert').innerText(), /找回未能保存/)
    assert.deepEqual(await bounds(), beforeFailure)
    assert.deepEqual((await page.evaluate(() => window.desktopPet.get())).position, stateBeforeFailure.position)
    assert.equal(await readFile(file, 'utf8'), '{isolated invalid fixture}')
  } finally { await writeFile(file, original) }
  await page.keyboard.press('Escape')
  checks.push('rejected preference save keeps the old native position and preserved file, with a visible retryable menu error')

  await click(pet.getByTestId('pet-window-menu-toggle'))
  await pet.getByTestId('desktop-pet-menu').waitFor()
  if (await pet.getByTestId('pet-radial-settings').count()) await click(pet.getByTestId('pet-radial-settings'))
  await click(pet.getByTestId('pet-open-settings'))
  await pet.getByTestId('pet-click-through').waitFor()
  await click(pet.getByTestId('pet-click-through'))
  await until(async () => (await pet.evaluate(() => window.desktopPet.get())).preferences.clickThrough, 'click-through saved')
  // Move the isolated native window to distinguish its old home from recovery.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).setPosition(100, 80))
  await pause(350)
  const old = (await page.evaluate(() => window.desktopPet.get())).position
  await tools.click()
  assert.match(await menu.innerText(), /鼠标穿透中/)
  await page.screenshot({ path: join(output, 'visible-tools.png') })
  await page.getByTestId('desktop-pet-locate').click(); await menu.waitFor({ state: 'detached' })
  assert.equal(await tools.evaluate(e => e === document.activeElement), true)
  const recovered = await page.evaluate(() => window.desktopPet.get())
  assert.equal(recovered.preferences.clickThrough, false)
  assert.notDeepEqual(recovered.position, old)
  const stored = JSON.parse(await readFile(join(profile, 'desktop-pet.json'), 'utf8'))
  assert.deepEqual(stored.position, recovered.position)
  assert.equal(stored.preferences.clickThrough, false)
  await click(pet.getByTestId('pet-position-lock'))
  await until(async () => (await pet.evaluate(() => window.desktopPet.get())).preferences.positionLocked, 'settings remain usable after locate')
  await close()
  observations.push({ case: 'visible-locate', old, recovered: recovered.position, stored: stored.position })
  checks.push('visible find button disables click-through, stores the recovered home and retains working settings; Electron input, not OS hit-testing coverage')

  await pet.evaluate(async () => {
    const s = await window.desktopPet.get()
    await window.desktopPet.command({ type: 'configure', preferences: { ...s.preferences, scale: 1.8 } })
  })
  await pause(250)
  const full = await metrics(), shortArea = { x: 0, y: 0, width: 640, height: 400 }
  try {
    await app.evaluate(({ screen }, workArea) => {
      globalThis.petOriginalDisplays = { nearest: screen.getDisplayNearestPoint, all: screen.getAllDisplays }
      const display = screen.getPrimaryDisplay()
      screen.getDisplayNearestPoint = () => ({ ...display, workArea })
      screen.getAllDisplays = () => [{ ...display, workArea }]
      screen.emit('display-metrics-changed', {}, { ...display, workArea }, ['workArea'])
    }, shortArea)
    await pause(350)
    const idle = await metrics()
    assert.ok(idle.canvas.height < full.canvas.height, 'short screen should fit selected 180% size')
    for (const kind of ['menu', 'settings', 'care', 'chat']) {
      await click(pet.getByTestId('pet-window-menu-toggle')); await pet.getByTestId('desktop-pet-menu').waitFor()
      if (kind !== 'menu') {
        const group = pet.getByTestId(`pet-radial-${kind}`)
        if (await group.count()) await click(group)
        await click(pet.getByTestId({ settings: 'pet-open-settings', care: 'pet-open-care', chat: 'pet-open-chat' }[kind]))
      }
      await until(async () => (await pet.evaluate(() => window.desktopPet.get())).layout.kind === kind, `${kind} opened`)
      await pause(450)
      const current = await metrics()
      for (const axis of ['width', 'height']) assert.ok(Math.abs(current.canvas[axis] - idle.canvas[axis]) <= 1, `${kind} shrank ${axis}`)
      for (const rect of [current.native, current.canvas, current.panel]) {
        assert.ok(rect.x >= -2 && rect.y >= -2 && rect.x + rect.width <= shortArea.width + 2 && rect.y + rect.height <= shortArea.height + 2, JSON.stringify({ kind, rect }))
      }
      assert.equal(current.overflow, false)
      assert.equal((await pet.evaluate(() => window.desktopPet.get())).preferences.scale, 1.8)
      if (kind === 'settings') await pet.screenshot({ path: join(output, 'short-screen-settings.png') })
      observations.push({ case: 'simulated-short-area', kind, idle, current })
      await close()
    }
  } finally {
    await app.evaluate(({ screen }) => {
      if (!globalThis.petOriginalDisplays) return
      screen.getDisplayNearestPoint = globalThis.petOriginalDisplays.nearest
      screen.getAllDisplays = globalThis.petOriginalDisplays.all
      delete globalThis.petOriginalDisplays
      screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea'])
    })
  }
  await pause(300)
  const restored = await metrics()
  for (const axis of ['width', 'height']) assert.ok(Math.abs(restored.canvas[axis] - full.canvas[axis]) <= 1, 'larger screen restores requested dimensions')
  assert.equal(JSON.parse(await readFile(join(profile, 'desktop-pet.json'), 'utf8')).preferences.scale, 1.8)
  observations.push({ case: 'screen-fit-restored', full, restored })
  checks.push('simulated 640×400 work area fits 180% uniformly; all four panels preserve that size; actual display restores 180% without changing saved preference')
  await pet.evaluate(async () => {
    const s = await window.desktopPet.get()
    await window.desktopPet.command({ type: 'configure', preferences: { ...s.preferences, scale: 1 } })
  })
  await tools.click(); await menu.getByRole('menuitem', { name: '关闭桌宠', exact: true }).click()
  await until(async () => !(await page.evaluate(() => window.desktopPet.get())).open, 'explicit close')
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, false)
  await page.getByTestId('external-companion').click()
  await until(async () => (await page.evaluate(() => window.desktopPet.get())).open, 'explicit reopen')
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, true)
  checks.push('visible tools close persists opt-out and the existing badge explicitly re-enables the pet')
}
