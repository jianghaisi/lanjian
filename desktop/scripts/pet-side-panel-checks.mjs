import assert from 'node:assert/strict'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function checkPetSidePanels({ app, pet, output, checks, observations, bounds }) {
  async function until(read, label) {
    for (let i = 0; i < 100; i++) { if (await read()) return; await pause(50) }
    throw new Error(`Timed out: ${label}`)
  }
  async function click(control) {
    await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(450)
    const rect = await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({ BrowserWindow }, point) => {
      const contents = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown', 'mouseUp']) contents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point })
    }, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) })
  }
  async function close() {
    await pet.keyboard.press('Escape')
    await until(async () => (await pet.evaluate(() => window.desktopPet.get())).layout.kind === null, 'panel closed')
    await pet.getByTestId('pet-side-panel').waitFor({ state: 'detached' })
  }
  async function metrics() {
    const native = await bounds()
    return pet.evaluate(native => {
      const canvas = document.querySelector('[data-testid="pet-artwork"] canvas').getBoundingClientRect()
      const overlay = document.querySelector('[data-testid="pet-side-panel"]')
      const rect = overlay?.getBoundingClientRect()
      return { canvas: { x: native.x + canvas.x, y: native.y + canvas.y, width: canvas.width, height: canvas.height },
        panel: rect && { x: native.x + rect.x, y: native.y + rect.y, width: rect.width, height: rect.height },
        side: overlay?.dataset.side, native, horizontalOverflow: overlay ? overlay.scrollWidth > overlay.clientWidth + 1 : false }
    }, native)
  }
  const area = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())), b = w.getBounds()
    return screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
  })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())); w.show(); w.focus() })
  for (const scale of [.6, 1, 1.8]) {
    await pet.evaluate(async scale => { const s = await window.desktopPet.get(); await window.desktopPet.command({ type: 'configure', preferences: { ...s.preferences, scale, positionLocked: false } }) }, scale)
    await pause(250)
    for (const edge of ['left', 'right']) {
      await app.evaluate(({ BrowserWindow }, { area, edge }) => {
        const w = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())), b = w.getBounds()
        w.setPosition(edge === 'left' ? area.x : area.x + area.width - b.width, area.y + area.height - b.height)
      }, { area, edge })
      await pause(350)
      const before = await metrics(), home = (await pet.evaluate(() => window.desktopPet.get())).position
      for (const kind of ['settings', 'care', 'chat']) {
        await click(pet.getByTestId('pet-window-menu-toggle'))
        await pet.getByTestId('desktop-pet-menu').waitFor()
        {
          if (kind !== 'chat') await click(pet.getByTestId(`pet-radial-${kind}`))
          await click(pet.getByTestId({ settings: 'pet-open-settings', care: 'pet-open-care', chat: 'pet-open-chat' }[kind]))
          await pet.getByTestId({ settings: 'pet-settings-panel', care: 'pet-care-panel', chat: 'pet-chat-panel' }[kind]).waitFor()
        }
        await pause(120)
        const current = await metrics()
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(current.canvas[key] - before.canvas[key]) <= 1, `${kind} changed character ${key}: ${JSON.stringify({ before, current })}`)
        assert.equal(current.side, edge === 'left' ? 'right' : 'left')
        assert.ok(current.panel.x + current.panel.width < current.canvas.x || current.panel.x > current.canvas.x + current.canvas.width)
        assert.ok(current.panel.x >= area.x && current.panel.y >= area.y && current.panel.x + current.panel.width <= area.x + area.width && current.panel.y + current.panel.height <= area.y + area.height)
        assert.equal(current.horizontalOverflow, false)
        assert.deepEqual((await pet.evaluate(() => window.desktopPet.get())).position, home)
        observations.push({ case: 'side-panel', scale, edge, kind, ...current })
        if (scale === 1) await pet.screenshot({ path: join(output, `${kind}-${edge}.png`) })
        if (kind === 'settings' && scale === 1 && edge === 'right') {
          const settings = pet.getByTestId('pet-settings-panel')
          await click(settings.getByTestId('pet-position-lock'))
          await until(async () => (await pet.evaluate(() => window.desktopPet.get())).preferences.positionLocked, 'lock saved')
          assert.deepEqual((await pet.evaluate(() => window.desktopPet.get())).position, home)
          await click(settings.getByTestId('pet-position-lock'))
          await until(async () => !(await pet.evaluate(() => window.desktopPet.get())).preferences.positionLocked, 'unlock saved')
          await click(settings.getByRole('button', { name: '模型与声音', exact: true }))
          await settings.getByTestId('companion-sound-volume').waitFor()
          await pet.screenshot({ path: join(output, 'settings-voice.png') })
          await click(settings.getByTestId('companion-voice-check').locator('summary'))
          await click(settings.getByTestId('voice-check-start'))
          await settings.getByTestId('voice-check-result').filter({ hasText: '语音功能已关闭' }).waitFor()
        }
        await close()
        const after = await metrics()
        for (const key of ['x', 'y', 'width', 'height']) {
          // Electron's frameless extent rounds through physical pixels at
          // fractional OS DPI. The actual character anchor is the stricter gate.
          assert.ok(Math.abs(after.native[key] - before.native[key]) <= 2, `native ${key} did not restore`)
          assert.ok(Math.abs(after.canvas[key] - before.canvas[key]) <= 1, `character ${key} did not restore`)
        }
        assert.deepEqual((await pet.evaluate(() => window.desktopPet.get())).position, home)
      }
    }
  }
  await pet.evaluate(async () => { const s = await window.desktopPet.get(); await window.desktopPet.command({ type: 'configure', preferences: { ...s.preferences, scale: 1 } }) })
  checks.push('18 native settings/care/chat cases preserve character size and anchor at 60/100/180%, choose left/right, stay on screen and restore saved home; native extent allows fractional-DPI rounding')
  checks.push('side settings save lock without persisting expanded bounds; shared voice controls and muted self-check use the pet host')
}
