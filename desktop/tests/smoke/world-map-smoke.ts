import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BrowserWindow, KeyboardInputEvent } from 'electron'
import type { Chapter } from '../../src/contracts/index'
import { decodeWorldMapDocument, decodeWorldMapView } from '../../src/contracts/world-map/world-map'

export type WorldMapSmokeSeed = { firstLocation: string; secondLocation: string; firstChapterId: number; secondChapterId: number; canonicalEventId: string }
/** Real fixture service writes only, after the runner verifies temp book isolation. */
export type WorldMapSmokeSeeder = () => Promise<WorldMapSmokeSeed>

export async function runWorldMapSmoke(window: BrowserWindow, capturePath: string, seed: WorldMapSmokeSeeder) {
  const output = join(dirname(capturePath), 'world-map')
  const checks: string[] = [], screenshots: string[] = [], layouts: unknown[] = []
  const original = { throttle: window.webContents.getBackgroundThrottling(), zoom: window.webContents.getZoomFactor(), bounds: window.getBounds() }
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`
  const testId = (id: string) => `[data-testid="${id}"]`
  const locationSelector = (name: string) => `${testId('map-location')}[data-location=${JSON.stringify(name)}]`
  let stage = 'isolation', isolated = false
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100) }
    throw new Error(`world-map-timeout:${label}`)
  }
  const paint = async () => {
    assert.ok(isolated, 'world-map-unverified-window')
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    if (!window.isFocused()) window.focus()
    await waitFor(`document.visibilityState==='visible'`, 'visible-frame')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      assert.ok(await Promise.race([evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500) })]), 'world-map-frame-timeout')
    } finally { clearTimeout(timer) }
  }
  const key = (keyCode: string, modifiers: KeyboardInputEvent['modifiers'] = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = async (selector: string) => {
    await waitFor(query(selector), selector)
    await evaluate(`${query(selector)}.scrollIntoView({block:'nearest',inline:'nearest'})`)
    await paint()
    const point = await evaluate(`(()=>{const e=${query(selector)},r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&!e.disabled&&!e.closest('[inert]')&&e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(point.hit, `world-map-obscured:${selector}:${JSON.stringify(point)}`)
    const zoom = window.webContents.getZoomFactor()
    for (const type of ['mouseDown', 'mouseUp'] as const) window.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const input = async (id: string, text: string) => {
    await click(testId(id)); key('a', ['control']); key('Backspace'); if (text) await window.webContents.insertText(text); key('Tab'); await paint()
    if (await evaluate(`${query(testId(id))}.value`) !== text) {
      await evaluate(`(()=>{const e=${query(testId(id))};const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur()})()`)
      await paint()
    }
    assert.equal(await evaluate(`${query(testId(id))}.value`), text, `world-map-native-input:${id}`)
  }
  const select = async (id: string, value: string) => {
    const selector = testId(id)
    const index = await evaluate(`[...${query(selector)}.options].findIndex(o=>o.value===${JSON.stringify(value)})`)
    assert.ok(index >= 0, `world-map-missing-option:${value}`)
    await click(selector); key('Escape'); await paint()
    await waitFor(`document.activeElement===${query(selector)}`, 'select-focused')
    key('Home'); await paint()
    for (let i = 0; i < index; i++) { key('Down'); await paint() }
    key('Tab'); await paint()
    await waitFor(`${query(selector)}.value===${JSON.stringify(value)}`, `native-select:${value}`)
  }
  const capture = async (name: string) => {
    await delay(250); await paint()
    const zoom = window.webContents.getZoomFactor(), viewport = await evaluate('({width:innerWidth,height:innerHeight})')
    const file = `${name}.png`
    await writeFile(join(output, file), (await window.capturePage()).toPNG())
    assert.equal(window.webContents.getZoomFactor(), zoom)
    assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), viewport)
    screenshots.push(file); layouts.push({ kind: 'capture', name, zoom, viewport })
  }
  const assertBounds = async (name: string) => {
    const metrics = await evaluate(`(()=>{const measure=s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();if(!r)return{selector:s,missing:true};const x=r.x+r.width/2,y=r.y+r.height/2,style=getComputedStyle(e);return{selector:s,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,overflowX:e.scrollWidth-e.clientWidth,overflowY:e.scrollHeight-e.clientHeight,hit:e.contains(document.elementFromPoint(x,y)),gap:style.gap,padding:style.padding,rows:style.gridTemplateRows}};return{width:innerWidth,height:innerHeight,roots:['html','body','.app-frame','.world-map-workbench','.world-map'].map(measure),panels:['.map-canvas','.map-inspector','.map-inspector-scroll'].map(measure),controls:['[data-testid="map-search"]','[data-testid="map-through-chapter"]','[data-testid="map-save"]'].map(measure)}})()`)
    layouts.push({ name, zoom: window.webContents.getZoomFactor(), contentSize: window.getContentSize(), ...metrics })
    for (const root of metrics.roots) assert.ok(!root.missing && root.y >= -1 && root.bottom <= metrics.height + 1 && root.overflowX <= 1 && root.overflowY <= 1, `world-map-root-overflow:${JSON.stringify(root)}`)
    for (const panel of metrics.panels) assert.ok(!panel.missing && panel.width > 0 && panel.height > 0 && panel.y >= -1 && panel.bottom <= metrics.height + 1, `world-map-panel-clipped:${JSON.stringify(panel)}`)
    for (const control of metrics.controls) assert.ok(!control.missing && control.hit && control.x >= -1 && control.right <= metrics.width + 1 && control.y >= -1 && control.bottom <= metrics.height + 1, `world-map-control-clipped:${JSON.stringify(control)}`)
  }
  const enterWorkspace = async () => {
    const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    window.webContents.reload(); await loaded
    await waitFor(`document.querySelector('.project-library')||document.querySelector('.activitybar')`, 'renderer-mounted')
    if (await evaluate(`!!${query(testId('app-boot-skip'))}`)) await click(testId('app-boot-skip'))
    await waitFor(`!document.querySelector('[data-testid="app-boot"]')&&!document.querySelector('[data-testid="app-boot-skip"]')&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.app-frame[inert]')`, 'boot-settled')
    if (await evaluate(`!!document.querySelector('.project-library')`)) {
      await waitFor(`(()=>{const e=${query(testId('library-continue-writing'))};if(!e||e.disabled||e.closest('[inert]'))return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`, 'library-hit-ready')
      await click(testId('library-continue-writing'))
    }
    await waitFor(`document.querySelector('.activitybar')&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.app-frame[inert]')`, 'workspace-open')
  }
  const enterMap = async () => {
    await click('.activitybar [data-activity="timeline"]'); await click(testId('timeline-mode-map'))
    await waitFor(`${query(testId('world-map-view'))}?.getAttribute('aria-busy')==='false'&&${query(testId('map-canvas'))}`, 'map-loaded')
  }
  const readMap = async () => decodeWorldMapView(await evaluate('window.novelDesktop.workspace.getWorldMap()'))
  const prose = (chapters: Chapter[]) => chapters.map(({ id, title, content, revision, bodyVersionId }) => ({ id, title, content, revision, bodyVersionId }))
  try {
    const profilePath = process.env.LANJIAN_USER_DATA_PATH
    assert.ok(process.env.LANJIAN_SMOKE === '1' && profilePath && profilePath === process.env.LANJIAN_SMOKE_CREATE_PARENT, 'world-map-requires-isolated-smoke')
    const inside = (root: string, target: string) => { const part = relative(root, target); return !!part && !part.startsWith('..') && !isAbsolute(part) }
    const temp = await realpath(tmpdir()), profile = await realpath(profilePath!)
    assert.ok(inside(temp, profile), 'world-map-profile-outside-temp')
    const status = await evaluate('window.novelDesktop.projects.status()')
    assert.equal(status?.project?.title, '烟测书稿')
    const bookRoot = await realpath(resolve(status.project.path))
    assert.ok(inside(profile, bookRoot), 'world-map-book-outside-profile')
    isolated = true
    await mkdir(output, { recursive: true })
    window.webContents.setBackgroundThrottling(false)
    window.webContents.setZoomFactor(1); window.setContentSize(1440, 900)
    stage = 'seed-formal-fixture'
    const fixture = await seed()
    const before: Chapter[] = await evaluate('window.novelDesktop.chapters.list()')
    const first = before.find(chapter => chapter.id === fixture.firstChapterId), second = before.find(chapter => chapter.id === fixture.secondChapterId)
    assert.ok(first?.content && second?.content, 'world-map-fixture-needs-two-saved-chapters')
    const initial = await readMap(), canonical = initial.events.find(event => event.id === `canonical:${fixture.canonicalEventId}`)
    assert.equal(initial.events.length, 3, 'world-map-candidates-or-duplicates-in-formal-view')
    assert.equal(initial.events.filter(event => event.source === 'direct').length, 2)
    assert.equal(canonical?.chapterId, fixture.secondChapterId)
    assert.equal(initial.document.markers.length, 0, 'world-map-no-invented-locations')
    checks.push('isolated formal fixture: 2 direct events + 1 approved canonical; candidate excluded; explicit chapter identity; no generated coordinates')
    stage = 'native-location-placement'
    await enterWorkspace(); await enterMap()
    await click(locationSelector(fixture.firstLocation)); await click(testId('map-place')); await click(testId('map-canvas'))
    await waitFor(`${query(`${testId('map-pin')}[data-location=${JSON.stringify(fixture.firstLocation)}]`)}`, 'native-pin-created')
    assert.deepEqual((await readMap()).document, initial.document, 'world-map-unsaved-placement-wrote-data')
    await input('map-x', '25'); await input('map-y', '60'); await click(testId('map-apply-coordinates'))
    await click(locationSelector(fixture.secondLocation)); await input('map-x', '75'); await input('map-y', '30'); await click(testId('map-apply-coordinates'))
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-pin"]').length`), 2)
    await click(testId('map-save'))
    await waitFor(`${query(testId('map-save'))}?.disabled&&${query(testId('world-map-view'))}?.getAttribute('aria-busy')==='false'&&!document.querySelector('.map-status.dirty')`, 'map-save-acknowledged')
    const saved = await readMap()
    assert.deepEqual(saved.document.markers, [{ location: fixture.firstLocation, x: 25, y: 60 }, { location: fixture.secondLocation, x: 75, y: 30 }])
    assert.notEqual(saved.revision, initial.revision)
    const mirrorPath = await realpath(join(bookRoot, '.webnovel', 'config', 'world-map.json'))
    assert.ok(inside(bookRoot, mirrorPath), 'world-map-mirror-outside-book')
    assert.deepEqual(decodeWorldMapDocument(JSON.parse(await readFile(mirrorPath, 'utf8'))), saved.document)
    await assertBounds('wide'); await capture('map-wide')
    checks.push('native canvas click and coordinate inputs; explicit save; formal readback and readable JSON mirror agree')
    stage = 'reload-persistence'
    await enterWorkspace(); await enterMap()
    assert.deepEqual((await readMap()).document, saved.document)
    await waitFor(`document.querySelectorAll('[data-testid="map-pin"]').length===2`, 'persisted-pins-after-reload')
    await input('map-search', fixture.secondLocation)
    // Search includes event prose/results, not only the location label. The
    // first-location event explicitly mentions the second in its result.
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-location"]').length`), 2)
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-event"]').length`), 3)
    await input('map-search', canonical!.event)
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-location"]').length`), 1)
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-testid="map-event"]')].map(e=>e.dataset.eventId)`), [canonical!.id])
    await input('map-search', '')
    await select('map-through-chapter', String(first!.position))
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-event"]').length`), 0, 'world-map-future-or-unbound-event-leaked')
    await select('map-through-chapter', String(second!.position))
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="map-event"]').length`), 1)
    await select('map-through-chapter', 'all')
    checks.push('reload restores exact coordinates; full-field search retains matching result evidence; unique prose query isolates its event; chapter cutoff excludes future and unbound events')
    stage = 'native-pin-movement'
    const firstPin = `${testId('map-pin')}[data-location=${JSON.stringify(fixture.firstLocation)}]`
    await click(firstPin)
    key('Right'); await paint()
    await waitFor(`${query(testId('map-x'))}?.value==='26'`, 'pin-keyboard-one-percent-step')
    const dragPoint = await evaluate(`(()=>{const pin=${query(firstPin)},r=pin.getBoundingClientRect(),plot=document.querySelector('.map-plot').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,dx:plot.width*.1,dy:plot.height*-.1}})()`)
    const zoom = window.webContents.getZoomFactor()
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(dragPoint.x * zoom), y: Math.round(dragPoint.y * zoom), button: 'left', clickCount: 1 })
    for (let step = 1; step <= 5; step++) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((dragPoint.x + dragPoint.dx * step / 5) * zoom), y: Math.round((dragPoint.y + dragPoint.dy * step / 5) * zoom), button: 'left' })
      await paint()
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round((dragPoint.x + dragPoint.dx) * zoom), y: Math.round((dragPoint.y + dragPoint.dy) * zoom), button: 'left', clickCount: 1 })
    await paint()
    const dragged = await evaluate(`({x:Number(${query(testId('map-x'))}.value),y:Number(${query(testId('map-y'))}.value)})`)
    layouts.push({ kind: 'native-pin-drag', from: { x: 26, y: 60 }, to: dragged })
    assert.ok(Math.abs(dragged.x - 36) < 1 && Math.abs(dragged.y - 50) < 1, `world-map-native-drag-position:${JSON.stringify(dragged)}`)
    assert.deepEqual((await readMap()).document, saved.document, 'world-map-pin-movement-persisted-without-save')
    await click(testId('map-cancel')); await click(testId('map-confirm-discard'))
    await waitFor(`!document.querySelector('.map-status.dirty')&&${query(testId('map-x'))}?.value==='25'`, 'discarded-pin-movement')
    checks.push('native focused pin Right key moves 1%; mouse drag moves 10% each axis; neither writes until save; confirmed discard restores both coordinates')
    stage = 'dirty-navigation-protection'
    await click(locationSelector(fixture.secondLocation))
    const eventSelector = `${testId('map-event')}[data-event-id=${JSON.stringify(`canonical:${fixture.canonicalEventId}`)}]`
    await click(eventSelector); await input('map-x', '70'); await click(testId('map-apply-coordinates'))
    await click(testId('map-open-chapter'))
    assert.ok(await evaluate(`!!${query(testId('world-map-view'))}&&!!document.querySelector('.map-status.dirty')`), 'world-map-dirty-chapter-navigation-not-blocked')
    await click(testId('map-open-event'))
    assert.ok(await evaluate(`!!${query(testId('world-map-view'))}&&!!document.querySelector('.map-status.dirty')`), 'world-map-dirty-event-navigation-not-blocked')
    assert.deepEqual((await readMap()).document, saved.document)
    await click(testId('map-cancel')); await click(testId('map-confirm-discard'))
    await waitFor(`!document.querySelector('.map-status.dirty')`, 'discarded-draft')
    assert.deepEqual((await readMap()).document, saved.document)
    checks.push('unsaved coordinate adjustments block chapter/event navigation; confirmed discard restores saved map without data writes')
    stage = 'compact-125'
    window.setContentSize(1100, 800); await delay(300); await paint(); window.webContents.setZoomFactor(1.25)
    await waitFor(`Math.abs(innerWidth-880)<=1&&Math.abs(innerHeight-640)<=1`, 'real-125-css-viewport')
    assert.equal(window.webContents.getZoomFactor(), 1.25)
    await assertBounds('compact-125'); await capture('map-compact-125')
    checks.push('real 125% scaling in 1100×800 window; no outer-page scrolling; map and inspector remain within viewport')
    stage = 'source-navigation'
    await click(testId('map-open-event'))
    await waitFor(`document.querySelector('.timeline-node.open')&&!${query(testId('world-map-view'))}`, 'canonical-event-opened')
    assert.ok((await evaluate(`document.querySelector('.timeline-node.open').textContent`)).includes(canonical!.event), 'world-map-opened-wrong-event')
    await capture('map-source-event')
    await enterMap(); await click(locationSelector(fixture.secondLocation)); await click(eventSelector)
    assert.equal(await evaluate(`${query(testId('map-open-chapter'))}.dataset.chapterId`), String(fixture.secondChapterId))
    await click(testId('map-open-chapter'))
    await waitFor(`${query(testId('manuscript-title-input'))}?.value===${JSON.stringify(second!.title)}&&!document.querySelector('.app-frame[inert]')`, 'canonical-chapter-opened')
    await waitFor(`${query(testId('manuscript-input'))}?.textContent.includes(${JSON.stringify(fixture.secondLocation)})`, 'canonical-prose-visible')
    assert.deepEqual(prose(await evaluate('window.novelDesktop.chapters.list()')), prose(before), 'world-map-mutated-source-prose')
    assert.deepEqual((await readMap()).document, saved.document)
    await capture('map-source-chapter')
    checks.push('native canonical event and stable-ID chapter jumps; all raw prose, titles, revisions and body versions unchanged')
    const result = { ok: true, checks, screenshots, layouts }
    await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2)); return result
  } catch (error) {
    if (isolated) await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, screenshots, layouts }
    if (isolated) await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    if (isolated) { window.webContents.setZoomFactor(original.zoom); window.setBounds(original.bounds); window.webContents.setBackgroundThrottling(original.throttle) }
  }
}
