import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Disposable profile only; countdown samples use real time, completion uses a documented near-end fixture. */
export async function checkPetFocus({ app, pet, profile, output, checks, observations }) {
  const settings = await pet.evaluate(() => window.companionSettings.get())
  const state = () => pet.evaluate(() => window.companionCare.get())
  const panel = pet.getByTestId('pet-care-panel'), clock = panel.locator('.focus-card strong')
  async function click(control) {
    await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(450)
    const rect = await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({ BrowserWindow }, point) => {
      const web = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown', 'mouseUp']) web.sendInputEvent({ type, button: 'left', clickCount: 1, ...point })
    }, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) })
  }
  async function act(action) {
    return pet.evaluate(async action => {
      const value = await window.companionCare.get()
      return window.companionCare.act({ requestId: crypto.randomUUID(), revision: value.revision, action })
    }, action)
  }
  async function open() { await click(pet.getByTestId('pet-window-menu-toggle')); await click(pet.getByTestId('pet-open-activities')); await panel.waitFor() }
  try {
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true, reducedMotion: true }))
    await open()
    await panel.getByRole('combobox', { name: '专注时长' }).selectOption('5')
    await click(pet.getByTestId('pet-focus-start'))
    await panel.getByRole('button', { name: '暂停', exact: true }).waitFor()
    const samples = []
    for (let i = 0; i < 4; i++) { samples.push(await clock.innerText()); if (i < 3) await pause(1100) }
    observations.push({ case: 'real-focus-seconds', samples })
    assert.ok(samples.every(value => /^\d{2}:\d{2}$/.test(value)), 'sample only the confirmed running clock, not the start placeholder')
    assert.ok(new Set(samples).size >= 3, '3.3 real seconds should show second-by-second progress, not one five-second jump')
    assert.equal((await state()).focus.status, 'running')
    await pet.screenshot({ path: join(output, 'focus-running.png') })
    checks.push('real wall-clock sampling shows second-by-second countdown and a progress bar while main owns the running focus')

    // Stress real main IPC while real time passes: these unrelated operations
    // must not continually reset the five-second care clock.
    const beforeInterference = await state(), interferenceStart = performance.now()
    for (let i = 0; i < 18; i++) {
      await pet.evaluate(volume => window.companionSettings.update({ voice: { volume } }), i % 2 ? .6 : .5)
      if (i === 5) await act({ type: 'pat' })
      if (i === 12) await act({ type: 'buy', item: 'water' })
      await pause(400)
    }
    const afterInterference = await state(), elapsedReal = (performance.now() - interferenceStart) / 1000
    const elapsedSaved = afterInterference.focus.elapsed - beforeInterference.focus.elapsed
    observations.push({ case: 'real-focus-unrelated-operations', preferenceChanges: 18, elapsedReal, elapsedSaved, before: beforeInterference.focus.elapsed, after: afterInterference.focus.elapsed })
    assert.ok(elapsedSaved >= 4, `unrelated care/settings discarded elapsed time: ${elapsedSaved}s saved across ${elapsedReal}s real time`)
    assert.ok(elapsedSaved <= elapsedReal + 5, 'five-second projection cadence cannot justify double-counting elapsed time')
    assert.equal(afterInterference.coins, beforeInterference.coins - 2)
    assert.equal(afterInterference.inventory.water, beforeInterference.inventory.water + 1)
    assert.equal(afterInterference.focus.status, 'running')
    checks.push('18 real preference updates plus pat/purchase preserve main-owned focus time and settle the purchase exactly once')

    await click(panel.getByRole('button', { name: '暂停', exact: true }))
    await pause(100)
    const paused = await clock.innerText(), saved = await state()
    await pause(2200); assert.equal(await clock.innerText(), paused)
    assert.equal((await state()).focus.elapsed, saved.focus.elapsed)
    await click(panel.getByRole('button', { name: '继续', exact: true }))
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: false }))
    await pause(100)
    const disabled = await clock.innerText()
    await pause(2200); assert.equal(await clock.innerText(), disabled)
    assert.match(await panel.getByTestId('pet-focus-status').innerText(), /养成已暂停/)
    assert.equal(await panel.getByTestId('pet-focus-toggle').isDisabled(), true)
    checks.push('pause and disabled care freeze both the visible clock and acknowledged progress; the status does not claim counting')

    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true }))
    await act({ type: 'sleep' })
    assert.equal(await panel.getByTestId('pet-focus-toggle').isDisabled(), true)
    assert.match(await panel.getByTestId('pet-focus-toggle').getAttribute('title'), /唤醒/)
    await click(panel.getByRole('button', { name: '去照料唤醒', exact: true }))
    await click(panel.getByTestId('pet-sleep'))
    assert.equal((await state()).sleeping, false)
    await click(panel.getByRole('button', { name: '活动', exact: true }))
    await click(panel.getByRole('button', { name: '继续', exact: true }))
    checks.push('sleep disables resume and offers a working care/wake path before returning to focus')

    // Stop real ticking before preparing only this synthetic file. Await get to
    // drain any earlier store operation; main must perform the actual completion.
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: false, reducedMotion: false }))
    const before = await state(), seeded = { ...before, revision: before.revision + 1, focus: { ...before.focus, elapsed: before.focus.duration - 2, status: 'running' } }
    await writeFile(join(profile, 'companion-care.json'), JSON.stringify(seeded, null, 2))
    await state()
    await pet.evaluate(() => {
      window.petFocusFeedbackEvents = []
      let last = ''
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="pet-status"]').textContent
        if (text.includes('专注完成了') && text.includes('奖励已入账') && text !== last) window.petFocusFeedbackEvents.push(text)
        last = text
      }).observe(document.querySelector('[data-testid="pet-status"]'), { childList: true, characterData: true, subtree: true })
    })
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true }))
    await pet.waitForFunction(() => document.querySelector('[data-testid="pet-focus-status"]').textContent.includes('已入账'), null, { timeout: 15_000 })
    const completed = await state()
    assert.equal(completed.focus.status, 'complete'); assert.equal(await clock.innerText(), '00:00')
    assert.equal(completed.coins, before.coins + 15); assert.equal(completed.experience, before.experience + 40); assert.equal(completed.totals.focus, before.totals.focus + 1)
    assert.equal(await pet.evaluate(() => window.petFocusFeedbackEvents.length), 1)
    assert.equal(await pet.locator('.speech').count(), 0)
    await pet.locator('[data-testid="pet-artwork"][data-clip="success"]').waitFor()
    await pet.screenshot({ path: join(output, 'focus-complete.png') })
    await state(); await state(); await pause(5400)
    const after = await state()
    assert.equal(after.coins, completed.coins); assert.equal(after.experience, completed.experience); assert.equal(after.totals.focus, completed.totals.focus)
    assert.equal(await pet.evaluate(() => window.petFocusFeedbackEvents.length), 1)
    await panel.getByRole('button', { name: '关闭照料面板' }).press('Escape'); await pause(350); await open()
    assert.match(await panel.getByTestId('pet-focus-status').innerText(), /已入账/)
    assert.equal(await pet.evaluate(() => window.petFocusFeedbackEvents.length), 1, 'reopening must not replay completed focus feedback')
    observations.push({ case: 'near-end-focus-fixture', seededElapsed: seeded.focus.elapsed, duration: seeded.focus.duration, beforeCoins: before.coins, afterCoins: after.coins, beforeExperience: before.experience, afterExperience: after.experience, completionFeedback: await pet.evaluate(() => window.petFocusFeedbackEvents.length) })
    checks.push('real main tick completes the explicitly near-end fixture, commits rewards once, and emits one local completion feedback without replay on refresh/reopen')
  } finally {
    await act({ type: 'focus-cancel' }).catch(() => {})
    await pet.evaluate(settings => window.companionSettings.update({ careEnabled: settings.careEnabled, reducedMotion: settings.reducedMotion, voice: { volume: settings.voice.volume } }), settings).catch(() => {})
    await panel.getByRole('button', { name: '关闭照料面板' }).press('Escape').catch(() => {})
  }
}
