import assert from 'node:assert/strict'
import { approvedLandmarks } from './approved-novel-landmarks.mjs'

// Only called by the isolated profile/book smoke. Names/pixels are raster landmarks,
// while all event records below are synthetic; no author timeline is a test fixture.
export async function verifyLandmarkBindings({ page, click, capture, interactions }) {
  const raw = '校园合成场景、住处合成场景与公共交通'
  const records = [
    { id: 'landmark-composite', title: '跨地点关联验收', time: '样例日', characters: '样例人物', location: raw, event: '隔离样例：同一事件在两处查看。', result: '不改变地点原文。' },
    { id: 'landmark-unknown', title: '未明确地点验收', time: '样例次日', characters: '样例人物', location: '尚未确定的校外地点', event: '不得强行关联。', result: '保留原文待补充。' },
  ]
  await page.evaluate(events => window.novelDesktop.workspace.saveTimeline(events), records)
  const current = await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())
  const markers = approvedLandmarks.map(({ location, pixel }, i) => ({ location, x: pixel[0] / 1536 * 100, y: pixel[1] / 1024 * 100, ...(i < 2 ? { sourceLocations: [raw] } : {}) }))
  await page.evaluate(input => window.novelDesktop.workspace.saveWorldMap(input), { workItemId: current.workItemId, expectedRevision: current.revision, document: { ...current.document, markers } })
  await click('[data-testid="timeline-mode-map"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-pin"]').length === 9)
  if (await page.locator('.map-inspector').count()) await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  await page.getByRole('button', { name: '适应画面', exact: true }).click()
  const widthAt = async () => page.locator('[data-testid="map-pin"]').first().evaluate(el => el.getBoundingClientRect().width)
  const width = await widthAt()
  assert.ok(width >= 43 && width <= 45)
  const persistentSignals = async () => {
    const selectedCount = await page.locator('.map-pin.selected').count()
    assert.ok(selectedCount <= 1)
    assert.equal(await page.locator('.map-beacon').count(), selectedCount)
    assert.equal(await page.locator('.map-pin:not(.selected) .map-beacon').count(), 0, 'unselected places never keep a beam')
    assert.equal(await page.locator('.map-ground-rings').count(), 9)
    const signals = await page.locator('.map-pin').evaluateAll(pins => pins.map(pin => {
      const beamElement = pin.querySelector('.map-beacon')
      const beam = beamElement ? getComputedStyle(beamElement) : null
      return { color: getComputedStyle(pin.querySelector('circle:not(.map-pin-ring)')).fill, height: beam?.height, width: beam?.width, animation: beam?.animationName, rings: getComputedStyle(pin.querySelector('.map-ground-rings')).opacity }
    }))
    assert.ok(signals.every(signal => signal.color === 'rgb(225, 62, 32)' && signal.rings === '0.95' && (!signal.height || (signal.height === '104px' && signal.width === '3px' && signal.animation === 'none'))), JSON.stringify(signals))
  }
  assert.equal(await page.locator('.map-pin.selected').count(), 0)
  await persistentSignals()
  await capture('07-nine-landmarks-overview')
  await page.locator('[data-testid="map-pin"][data-location="洪州一中"] > span').hover()
  assert.equal(await page.locator('.map-beacon').count(), 0, 'hover alone does not reveal a shaft')
  await capture('10-idle-dots-and-rings')
  // Native clicks well outside each circle/44px button, including left-facing labels.
  const clickNameplate = async location => {
    const pin = page.locator(`[data-testid="map-pin"][data-location="${location}"]`)
    const button = await pin.boundingBox(), label = await pin.locator(':scope > span').boundingBox()
    assert.ok(button && label)
    const x = label.x < button.x ? label.x + 6 : label.x + label.width - 6
    const y = label.y + label.height / 2
    assert.ok(x < button.x || x > button.x + button.width, 'test must click text beyond the circle target')
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.map-pin')?.getAttribute('data-location'), { x, y }), location)
    const transform = await page.locator('.map-plot').getAttribute('style')
    await page.mouse.click(x, y)
    await page.waitForFunction(name => document.querySelector('.map-inspector > header h3')?.textContent === name, location)
    assert.equal(await pin.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('.map-plot').getAttribute('style'), transform, 'nameplate click must not pan the map')
    await persistentSignals()
  }
  for (const { location } of approvedLandmarks) {
    await clickNameplate(location)
    await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
    await page.locator('.map-inspector').waitFor({ state: 'detached' })
    await persistentSignals()
  }
  await clickNameplate('洪州一中')
  await capture('07-nameplate-dossier')
  await capture('10-clicked-single-shaft')
  await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  await page.locator('.map-inspector').waitFor({ state: 'detached' })
  await clickNameplate('洪州一中') // Same selected name reopens a closed dossier.
  for (const key of ['Enter', 'Space']) {
    await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
    await page.locator('.map-inspector').waitFor({ state: 'detached' })
    await page.locator('[data-testid="map-pin"][data-location="李家"]').focus()
    await page.keyboard.press(key)
    await page.waitForFunction(() => document.querySelector('.map-inspector > header h3')?.textContent === '李家')
  }
  await click('[data-testid="map-labels"]')
  assert.equal(await page.locator('.map-pin > span').count(), 0)
  await persistentSignals()
  await page.locator('[data-location="洪州一中"] > svg').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-event"]').length === 1)
  assert.equal(await page.locator('.map-inspector > header h3').textContent(), '洪州一中')
  await click('[data-testid="map-labels"]')
  await persistentSignals()
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())).document, { ...current.document, markers }, 'browse/nameplate/keyboard/label visibility never changes the saved map')
  const signal = await page.locator('.map-pin.selected').evaluate(pin => {
    const beam = getComputedStyle(pin.querySelector('.map-beacon'))
    return { color: getComputedStyle(pin.querySelector('circle:not(.map-pin-ring)')).fill, height: beam.height, width: beam.width, halo: getComputedStyle(pin.querySelector('.map-beacon'), '::before').filter }
  })
  assert.equal(signal.color, 'rgb(225, 62, 32)')
  assert.equal(signal.height, '104px'); assert.equal(signal.width, '3px')
  assert.equal(signal.halo, 'blur(6px)')
  await capture('07-selected-beacon-100')
  await click('[data-testid="map-event"]')
  assert.match(await page.locator('[data-testid="map-event-detail"]').textContent(), new RegExp(raw))
  assert.equal(await page.locator('.map-event-places button').count(), 2)
  await page.locator('.map-event-places').getByRole('button', { name: '李家' }).click()
  assert.equal(await page.locator('[data-testid="map-pin"][data-location="李家"]').getAttribute('aria-pressed'), 'true')
  assert.match(await page.locator('[data-testid="map-event-detail"]').textContent(), /跨地点关联验收/)
  await capture('08-multi-place-dossier')
  await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '放大地图', exact: true }).click()
  assert.ok(Math.abs(await widthAt() - width) < 1, 'beacon and pointer target stay legible without growing with terrain')
  await persistentSignals()
  await capture('09-selected-beacon-zoom')
  await capture('10-single-shaft-zoom')
  await clickNameplate('李家')
  await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.ok((await page.locator('.map-beacon').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName))).every(name => name === 'none'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: '适应画面', exact: true }).click()
  // Search by a bound label absent from the raw location is still meaningful.
  await page.evaluate(() => {
    const input = document.querySelector('.map-search input')
    window.__mapInputTrace = []
    for (const type of ['focusin','keydown','beforeinput','input','compositionstart','compositionend','change']) input.addEventListener(type, event => {
      const record = phase => window.__mapInputTrace.push({ type, phase, value: input.value, targetValue: event.target.value, connected: input.isConnected, maxLength: input.maxLength, data: event.data, composing: input.composing, eventComposing: event.isComposing, key: event.key, inputType: event.inputType, pins: document.querySelectorAll('[data-testid="map-pin"]').length })
      record('event'); queueMicrotask(() => record('microtask')); requestAnimationFrame(() => record('frame'))
    }, true)
  })
  await page.locator('.map-search input').click()
  await page.keyboard.insertText('李家')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-pin"]').length === 2).catch(async error => {
    assert.fail(JSON.stringify({ error: String(error), trace: await page.evaluate(() => window.__mapInputTrace) }))
  })
  assert.equal(await page.locator('[data-testid="map-pin"]').count(), 2)
  await page.locator('.map-search input').fill('')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-pin"]').length === 9)
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', { text: '李', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '李家' })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-pin"]').length === 2)
    assert.equal(await page.locator('.map-search input').inputValue(), '李家')
  } finally { await cdp.detach() }
  await page.locator('.map-search input').fill('')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="map-pin"]').length === 9)
  await page.locator('[data-location="洪州一中"] > svg').click()
  await click('[data-testid="map-edit-mode"]')
  await page.locator('[data-testid="map-pin"][data-location="洪州一中"]').focus(); await page.keyboard.press('ArrowRight')
  await click('[data-testid="map-save"]')
  await page.waitForFunction(() => document.querySelector('.map-save-status')?.textContent?.includes('地点定位已保存'))
  const after = await page.evaluate(() => window.novelDesktop.workspace.getWorldMap())
  assert.deepEqual(after.document.markers[0].sourceLocations, [raw])
  assert.deepEqual((await page.evaluate(() => window.novelDesktop.workspace.getTimeline())).events, records)
  await click('[data-testid="map-browse-mode"]')
  await page.getByRole('button', { name: '关闭地点档案', exact: true }).click()
  await page.getByRole('button', { name: '适应画面', exact: true }).click()
  await click('[data-testid="timeline-mode-events"]')
  interactions.push('nine raster landmarks / 44px fixed targets', 'many-to-many event chips preserve original scene', 'bound-name search / native IME commit survives companion quiet state', 'bindings survive native nudge/save; timeline unchanged', 'persistent dots/rings; no beam before selection or on hover; one selected beam transfers between locations and stays correct at 250% zoom')
  interactions.push('nine native nameplate clicks outside circle / left- and right-facing labels / same-place reopen / no pan or save', 'Enter and Space open dossier / hidden labels preserve clickable circles, dots and rings', 'deep orange-red signal / selected static 104px bright beam / reduced motion')
}
