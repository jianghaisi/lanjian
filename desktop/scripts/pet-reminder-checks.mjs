import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Real isolated renderer/IPC; only renderer time is accelerated, not care settlement. */
export async function checkPetReminders({ app, page, pet, output, checks, observations }) {
  const original = await pet.evaluate(() => window.companionSettings.get())
  const preferences = (await pet.evaluate(() => window.desktopPet.get())).preferences
  const context = (await page.evaluate(() => window.desktopPet.get())).context
  const count = () => pet.evaluate(() => window.petReminderEvents.length)
  async function care(action) {
    return pet.evaluate(async action => {
      const s = await window.companionCare.get()
      return window.companionCare.act({ requestId: crypto.randomUUID(), revision: s.revision, action })
    }, action)
  }
  async function broadcast() {
    await pet.evaluate(async () => {
      const s = await window.desktopPet.get()
      await window.desktopPet.command({ type: 'configure', preferences: s.preferences })
    })
  }
  try {
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: false, reducedMotion: true, voice: { proactive: false } }))
    await page.evaluate(context => window.desktopPet.updateContext({ ...context, quiet: false, taskStatus: '', stateFeedback: false }), context)
    // Let pre-existing native greeting timers finish before installing a fake
    // clock; otherwise that action can remain busy outside the test clock.
    await pet.waitForFunction(() => document.querySelector('[data-testid="pet-artwork"]').dataset.intent === 'idle')
    await pet.clock.install()
    await pet.clock.pauseAt(new Date(Date.now() + 100))
    await pet.evaluate(() => {
      window.petReminderEvents = []
      let last = ''
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="pet-status"]').textContent
        if (text.startsWith('休息一下吧') && last !== text) window.petReminderEvents.push({ time: Date.now(), text })
        last = text
      }).observe(document.querySelector('[data-testid="pet-status"]'), { childList: true, subtree: true, characterData: true })
    })
    await pet.evaluate(async () => {
      const s = await window.desktopPet.get()
      await window.desktopPet.command({ type: 'configure', preferences: { ...s.preferences, reminderMinutes: 25 } })
      await window.companionSettings.update({ voice: { proactive: true } })
    })
    for (let i = 0; i < 4; i++) { await pet.clock.fastForward(300_000); await broadcast() }
    await pet.clock.fastForward(299_999); assert.equal(await count(), 0)
    await pet.clock.fastForward(1)
    observations.push({ case: 'reminder-first-deadline', state: await pet.evaluate(() => window.desktopPet.get()), renderer: await pet.evaluate(() => ({ hidden: document.hidden, status: document.querySelector('[data-testid="pet-status"]').textContent, artwork: { ...document.querySelector('[data-testid="pet-artwork"]').dataset } })), settings: await pet.evaluate(() => window.companionSettings.get()) })
    assert.equal(await count(), 1, 'equal native projections must not keep postponing the reminder')
    assert.match(await pet.getByTestId('pet-status').innerText(), /^休息一下吧/)
    assert.equal(await pet.locator('.speech').count(), 0)
    assert.notEqual(await pet.getByTestId('pet-artwork').getAttribute('data-intent'), 'stretch', 'reduced motion keeps local reminder text without starting an action')
    await pet.screenshot({ path: join(output, 'reminder-status.png') })
    checks.push('renderer test clock: a 25-minute reminder survives equal native preference projections; reduced motion retains status text without speech or stretch')

    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true }))
    await care({ type: 'focus-start', minutes: 25 })
    await pet.clock.fastForward(1_500_000)
    assert.equal(await count(), 1, 'real focus must defer reminders')
    assert.equal((await pet.evaluate(() => window.companionCare.get())).focus.status, 'running', 'renderer time must not settle focus rewards')
    await care({ type: 'focus-pause' }); await pet.clock.fastForward(30_000)
    assert.equal(await count(), 2)
    await care({ type: 'focus-cancel' })
    checks.push('authoritative focus defers one reminder; pausing permits it and renderer time never completes or rewards focus')

    await care({ type: 'sleep' })
    await pet.clock.fastForward(1_500_000); await pet.clock.fastForward(3_600_000)
    assert.equal(await count(), 2)
    await care({ type: 'wake' }); await pet.clock.fastForward(30_000)
    assert.equal(await count(), 3)
    await pet.clock.fastForward(60_000); assert.equal(await count(), 3, 'missed reminders must not be replayed as a backlog')
    checks.push('sleep defers reminders; waking shows one overdue reminder and never drains a backlog')

    await care({ type: 'sleep' })
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: false }))
    await pet.clock.fastForward(1_500_000); assert.equal(await count(), 4, 'disabled care must not let old sleep data block reminders')
    checks.push('disabled care preserves the sleeping archive without allowing it to suppress active local reminders')

    await pet.evaluate(() => window.companionSettings.update({ voice: { proactive: false } }))
    await pet.clock.fastForward(3_600_000); assert.equal(await count(), 4)
    await pet.evaluate(() => window.companionSettings.update({ voice: { proactive: true } }))
    await pet.clock.fastForward(1_499_999); assert.equal(await count(), 4)
    await pet.clock.fastForward(1); assert.equal(await count(), 5)
    checks.push('proactive opt-out cancels reminders immediately; re-enabling starts a complete interval')
    observations.push({ case: 'reminder-renderer-clock', events: await pet.evaluate(() => window.petReminderEvents), method: 'Playwright renderer clock; real main IPC and isolated care state; not 25 minutes of wall-clock time' })
  } finally {
    await pet.clock.resume().catch(() => {})
    await pet.evaluate(original => window.companionSettings.update({ careEnabled: true, reducedMotion: original.reducedMotion, voice: { proactive: original.voice.proactive } }), original).catch(() => {})
    await care({ type: 'wake' }).catch(() => {})
    await care({ type: 'focus-cancel' }).catch(() => {})
    await pet.evaluate(original => window.companionSettings.update({ careEnabled: original.careEnabled }), original).catch(() => {})
    await pet.evaluate(preferences => window.desktopPet.command({ type: 'configure', preferences }), preferences).catch(() => {})
    await page.evaluate(context => window.desktopPet.updateContext(context), context).catch(() => {})
  }
}
