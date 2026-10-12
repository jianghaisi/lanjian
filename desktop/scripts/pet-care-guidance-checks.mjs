import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Seed edge cases only in the runner's disposable profile; transactions still use real main IPC. */
export async function checkPetCareGuidance({ app, pet, profile, output, checks, observations }) {
  const settings = await pet.evaluate(() => window.companionSettings.get())
  const state = () => pet.evaluate(() => window.companionCare.get())
  const panel = pet.getByTestId('pet-care-panel')
  async function click(control) {
    await control.waitFor(); await control.scrollIntoViewIfNeeded(); await pause(350)
    const rect = await control.boundingBox(); assert.ok(rect)
    await app.evaluate(({ BrowserWindow }, point) => {
      const web = BrowserWindow.getAllWindows().find(w => /pet\.html/.test(w.webContents.getURL())).webContents
      for (const type of ['mouseDown', 'mouseUp']) web.sendInputEvent({ type, button: 'left', clickCount: 1, ...point })
    }, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) })
    await pause(100)
  }
  async function seed(patch) {
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: false }))
    const previous = await state(), next = { ...previous, ...patch, revision: previous.revision + 1 }
    await writeFile(join(profile, 'companion-care.json'), JSON.stringify(next, null, 2))
    await state()
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true }))
    await pause(50)
    return next
  }
  async function open() { await click(pet.getByTestId('pet-window-menu-toggle')); await click(pet.getByTestId('pet-radial-care')); await click(pet.getByTestId('pet-open-care')); await panel.waitFor() }
  try {
    await pet.evaluate(() => window.companionSettings.update({ careEnabled: true, reducedMotion: true }))
    const original = await state()
    await open()
    // Known low energy must be blocked in both entries before the next five-second main tick.
    await seed({ energy: 7, sleeping: false })
    assert.equal(await panel.getByTestId('pet-use-toy').isDisabled(), true)
    assert.match(await panel.getByTestId('pet-use-toy').getAttribute('title'), /8 点体力/)
    assert.match(await panel.getByTestId('pet-rest-guidance').innerText(), /睡一会儿/)
    await click(panel.getByRole('button', { name: '背包 · 小铺', exact: true }))
    assert.equal(await panel.getByTestId('pet-bag-use-toy').isDisabled(), true)
    await click(panel.getByRole('button', { name: '去照料休息', exact: true }))
    await click(panel.getByTestId('pet-sleep'))
    assert.equal((await state()).sleeping, true)
    await click(panel.getByRole('button', { name: '背包 · 小铺', exact: true }))
    assert.equal(await panel.getByTestId('pet-bag-use-food').isDisabled(), true)
    await click(panel.getByRole('button', { name: '去照料唤醒', exact: true }))
    await click(panel.getByTestId('pet-sleep'))
    assert.equal((await state()).sleeping, false)
    checks.push('low energy blocks toy in care and bag; visible rest/wake navigation operates through existing controls')

    await seed({ energy: 80, coins: 0, inventory: { food: 999, water: 0, toy: 2 } })
    await click(panel.getByRole('button', { name: '去背包补充', exact: true }))
    assert.equal(await panel.getByTestId('pet-buy-food').isDisabled(), true)
    assert.match(await panel.getByTestId('pet-item-food').innerText(), /已满 999 件/)
    assert.equal(await panel.getByTestId('pet-buy-water').isDisabled(), true)
    assert.match(await panel.getByTestId('pet-item-water').innerText(), /还差 2 星币/)
    assert.equal(await panel.getByTestId('pet-bag-use-water').isDisabled(), true)
    await pet.screenshot({ path: join(output, 'bag-guidance.png') })
    const blocked = await state()
    await click(panel.getByTestId('pet-buy-food')); await click(panel.getByTestId('pet-buy-water'))
    const unchanged = await state()
    assert.deepEqual(unchanged.inventory, blocked.inventory); assert.equal(unchanged.coins, blocked.coins)
    assert.deepEqual(unchanged.receipts, blocked.receipts)
    checks.push('full inventory, missing items and exact coin shortfall are visible; disabled purchases send no transaction')

    const baseline = await seed({ ...original, experience: 0, totals: { fed: 0, played: 0, focus: 0 }, achievements: [], coins: 40, energy: 80, inventory: { food: 0, water: 1, toy: 1 }, daily: { ...original.daily, fed: false, drank: false, played: false, claimed: false } })
    await click(panel.getByTestId('pet-buy-food'))
    assert.equal((await state()).inventory.food, 1); assert.equal((await state()).coins, 32)
    await click(panel.getByTestId('pet-bag-use-food'))
    assert.equal((await state()).inventory.food, 0)
    await click(panel.getByRole('button', { name: '照料', exact: true }))
    const daily = panel.getByTestId('pet-daily-goals')
    assert.match(await daily.innerText(), /1 \/ 3/); assert.match(await daily.innerText(), /还差喝水、玩耍/)
    assert.equal(await panel.getByTestId('pet-claim-daily').isDisabled(), true)
    await click(panel.getByTestId('pet-use-water')); await click(panel.getByTestId('pet-use-toy'))
    assert.match(await daily.innerText(), /3 \/ 3/)
    assert.equal(await panel.getByTestId('pet-claim-daily').isDisabled(), false)
    await click(panel.getByTestId('pet-claim-daily'))
    const claimed = await state()
    assert.equal(claimed.daily.claimed, true); assert.equal(claimed.coins, 62)
    assert.equal(claimed.experience, baseline.experience + 8 + 5 + 10 + 25)
    assert.equal(await panel.getByTestId('pet-claim-daily').isDisabled(), true)
    await pet.screenshot({ path: join(output, 'daily-claimed.png') })
    await click(panel.getByTestId('pet-claim-daily')); await state()
    assert.equal((await state()).coins, claimed.coins)
    assert.equal((await state()).experience, claimed.experience)
    observations.push({ case: 'real-care-transactions-after-edge-fixtures', startCoins: baseline.coins, endCoins: claimed.coins, startExperience: baseline.experience, endExperience: claimed.experience })
    checks.push('native buy/use updates persisted inventory; daily missing goals follow acknowledged actions and reward is claimed once')

    await click(panel.getByRole('button', { name: '成长', exact: true }))
    assert.match(await panel.getByTestId('pet-badge-first-care').innerText(), /喂食一次\s+已达成/)
    assert.match(await panel.getByTestId('pet-badge-playmate').innerText(), /累计玩耍五次\s+1 \/ 5 次/)
    assert.match(await panel.getByTestId('pet-badge-focused').innerText(), /完成一次专注\s+0 \/ 1 次/)
    assert.match(await panel.getByTestId('pet-badge-growing').innerText(), /伙伴达到 Lv.3\s+1 \/ 3 级/)
    await pet.screenshot({ path: join(output, 'growth-progress.png') })
    const width = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    assert.ok(width.scroll <= width.client, 'side panel must not overflow horizontally')
    await panel.getByRole('button', { name: '关闭照料面板' }).press('Escape'); await pause(350); await open()
    assert.match(await panel.getByTestId('pet-daily-goals').innerText(), /今日奖励已入账/)
    assert.equal((await state()).coins, claimed.coins)
    checks.push('growth shows confirmed achievement requirements/progress; reopening preserves claimed daily state without awarding again')
  } finally {
    await pet.evaluate(settings => window.companionSettings.update({ careEnabled: settings.careEnabled, reducedMotion: settings.reducedMotion }), settings).catch(() => {})
    await panel.getByRole('button', { name: '关闭照料面板' }).press('Escape').catch(() => {})
  }
}
