import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BrowserWindow, KeyboardInputEvent } from 'electron'
import type { Chapter } from '../../src/contracts/index'

export type CharacterAtlasSmokeSeed = {
  characterName: string
  secondCharacterName: string
  firstChapterId: number
  secondChapterId: number
  firstLocation: string
  secondLocation: string
}
/** The callback uses existing main services to save fixture prose, create real
 * fact batches and approve their changes. No synthetic renderer state or API call. */
export type CharacterAtlasSmokeSeeder = () => Promise<CharacterAtlasSmokeSeed>

export async function runCharacterAtlasSmoke(window: BrowserWindow, capturePath: string, seed: CharacterAtlasSmokeSeeder) {
  const output = join(dirname(capturePath), 'character-atlas')
  const checks: string[] = [], screenshots: string[] = [], layouts: unknown[] = []
  const originalThrottle = window.webContents.getBackgroundThrottling()
  const originalZoom = window.webContents.getZoomFactor()
  const originalBounds = window.getBounds()
  const evaluate = (source: string) => window.webContents.executeJavaScript(source)
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  let stage = 'isolation', isolated = false
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100) }
    throw new Error(`character-atlas-timeout:${label}`)
  }
  const paint = async () => {
    if (!isolated) throw new Error('character-atlas-unverified-window')
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    if (!window.isFocused()) window.focus()
    await waitFor(`document.visibilityState==='visible'`, 'visible-paint')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))'), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500) })])
      if (!result) throw new Error('character-atlas-frame-timeout')
    } finally { clearTimeout(timer) }
  }
  const key = (keyCode: string, modifiers: KeyboardInputEvent['modifiers'] = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const click = async (selector: string, index = 0) => {
    await waitFor(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]`, selector)
    await evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].scrollIntoView({block:'nearest',inline:'nearest'})`)
    await paint()
    const point = await evaluate(`(()=>{const e=document.querySelectorAll(${JSON.stringify(selector)})[${index}],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:r.width>0&&r.height>0&&x>0&&y>0&&x<innerWidth&&y<innerHeight&&!e.disabled&&e.contains(document.elementFromPoint(x,y))}})()`)
    assert.ok(point.hit, `character-atlas-obscured:${selector}:${JSON.stringify(point)}`)
    const zoom = window.webContents.getZoomFactor()
    for (const type of ['mouseDown', 'mouseUp'] as const) window.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 })
    await paint()
  }
  const selectOption = async (selector: string, match: string) => {
    const options: Array<{ value: string; label: string }> = await evaluate(`[...document.querySelector(${JSON.stringify(selector)}).options].map(o=>({value:o.value,label:o.textContent}))`)
    const exactIndex = options.findIndex(option => option.value === match)
    const index = exactIndex >= 0 ? exactIndex : options.findIndex(option => option.label.includes(match))
    assert.ok(index >= 0, `character-atlas-option-missing:${match}:${JSON.stringify(options)}`)
    await click(selector)
    // Chromium's native popup owns its own event loop on Windows. Close that
    // popup first, then operate the focused closed select with settled native
    // keyboard events. No renderer value assignments or dispatched changes.
    key('Escape'); await paint()
    await waitFor(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`, 'native-select-focus')
    await evaluate(`(()=>{window.__atlasKeyEvidence=[];window.__atlasObserveKey=e=>{if(window.__atlasKeyEvidence.length<30)window.__atlasKeyEvidence.push({type:e.type,key:e.key,code:e.code,target:e.target?.getAttribute('data-testid'),value:document.querySelector(${JSON.stringify(selector)})?.value})};for(const kind of ['keydown','input','change'])document.addEventListener(kind,window.__atlasObserveKey,true)})()`)
    key('Home'); await paint()
    for (let step = 0; step < index; step++) { key('Down'); await paint() }
    key('Tab'); await paint()
    try {
      await waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(options[index]!.value)}`, `native-option:${match}`)
    } catch (error) {
      const diagnostic = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {selector:${JSON.stringify(selector)},expected:${JSON.stringify(options[index]!.value)},value:e?.value,selectedIndex:e?.selectedIndex,activeElement:{tag:document.activeElement?.tagName,id:document.activeElement?.id,testid:document.activeElement?.getAttribute('data-testid')},options:[...e.options].map(o=>({value:o.value,selected:o.selected,label:o.textContent})),documentFocused:document.hasFocus(),nativeEvents:window.__atlasKeyEvidence}})()`)
      throw new Error(`${error instanceof Error ? error.message : String(error)}:${JSON.stringify(diagnostic)}`)
    } finally {
      layouts.push({ kind: 'native-select-events', selector, expected: options[index]!.value, events: await evaluate('window.__atlasKeyEvidence') })
      await evaluate(`(()=>{for(const kind of ['keydown','input','change'])document.removeEventListener(kind,window.__atlasObserveKey,true);delete window.__atlasObserveKey;delete window.__atlasKeyEvidence})()`)
    }
  }
  const capture = async (name: string) => {
    // Zoom layout can settle before Chromium publishes the new compositor
    // surface. Allow that surface to present, then verify the captured state.
    await delay(250)
    await paint()
    const zoom = window.webContents.getZoomFactor()
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})')
    const file = `${name}.png`
    await writeFile(join(output, file), (await window.capturePage()).toPNG())
    assert.equal(window.webContents.getZoomFactor(), zoom, 'character-atlas-zoom-changed-during-capture')
    assert.deepEqual(await evaluate('({width:innerWidth,height:innerHeight})'), viewport, 'character-atlas-viewport-changed-during-capture')
    layouts.push({ kind: 'capture-state', name, zoomFactor: zoom, viewport })
    screenshots.push(file)
  }
  const assertBounds = async (label: string) => {
    const metrics = await evaluate(`(()=>{const selectors=['[data-testid="atlas-search"]','[data-testid="atlas-through-chapter"]','[data-testid="atlas-location-filter"]','[data-testid="atlas-detail"]'];const measure=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();if(!r)return {selector,missing:true};const x=r.x+r.width/2,y=r.y+r.height/2;return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(x,y)),overflowX:e.scrollWidth-e.clientWidth,overflowY:e.scrollHeight-e.clientHeight}};return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,controls:selectors.map(measure),roots:['html','body','.app-frame','.character-atlas'].map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e),before=e.scrollTop;e.scrollTop=before+1;const canScroll=e.scrollTop!==before;e.scrollTop=before;return {...measure(selector),gridRows:s.gridTemplateRows,overflow:s.overflow,canScroll,children:[...e.children].filter(c=>getComputedStyle(c).display!=='none').map(c=>{const r=c.getBoundingClientRect(),cs=getComputedStyle(c);return {tag:c.tagName,cls:String(c.className),top:r.top,bottom:r.bottom,height:r.height,minBlockSize:cs.minBlockSize,blockSize:cs.blockSize,overflow:cs.overflow,gridRow:cs.gridRow}})}}),panels:['.atlas-cards','[data-testid="atlas-detail"]'].map(measure)}})()`)
    layouts.push(metrics)
    layouts.push({ kind: 'atlas-spacing', label, elements: await evaluate(`['.character-atlas-workbench','.character-atlas-workbench > header','.character-atlas','.atlas-heading','.atlas-filters','.atlas-body','.atlas-detail-scroll'].map(selector=>{const e=document.querySelector(selector);if(!e)return {selector,missing:true};const s=getComputedStyle(e),r=e.getBoundingClientRect();return {selector,top:r.top,bottom:r.bottom,height:r.height,padding:s.padding,margin:s.margin,gap:s.gap,gridRows:s.gridTemplateRows,display:s.display,alignItems:s.alignItems,justifyContent:s.justifyContent,minHeight:s.minHeight,overflow:s.overflow}})`) })
    layouts.push({ kind: 'native-window-scale', label, zoomFactor: window.webContents.getZoomFactor(), contentSize: window.getContentSize(), cssViewport: { width: metrics.width, height: metrics.height } })
    assert.ok(metrics.overflow <= 1, 'character-atlas-page-horizontal-overflow')
    for (const root of metrics.roots) assert.ok(!root.missing && root.y >= -1 && root.bottom <= metrics.height + 1 && root.overflowY <= 1, `character-atlas-root-vertical-overflow:${JSON.stringify(root)}`)
    for (const panel of metrics.panels) assert.ok(!panel.missing && panel.width > 0 && panel.height > 0 && panel.y >= -1 && panel.bottom <= metrics.height + 1, `character-atlas-collapsed-or-clipped-panel:${JSON.stringify(panel)}`)
    for (const item of metrics.controls) assert.ok(!item.missing && item.width > 0 && item.height > 0 && item.x >= -1 && item.right <= metrics.width + 1, `character-atlas-width:${JSON.stringify(item)}`)
    for (const item of metrics.controls.slice(0, 3)) assert.ok(item.hit && item.y >= -1 && item.bottom <= metrics.height + 1, `character-atlas-control-clipped:${JSON.stringify(item)}`)
  }
  const enterAtlas = async () => {
    await click('.activitybar [data-activity="timeline"]')
    await click('[data-testid="timeline-mode-characters"]')
    await waitFor(`document.querySelector('[data-testid="atlas-search"]')`, 'default-character-cards')
    await waitFor(`document.querySelectorAll('[data-testid="atlas-card"]').length>=2`, 'formal-character-cards')
  }
  const proseFingerprint = (chapters: Chapter[]) => chapters.map(chapter => ({ id: chapter.id, title: chapter.title, content: chapter.content, revision: chapter.revision, bodyVersionId: chapter.bodyVersionId }))
  try {
    const userData = process.env.LANJIAN_USER_DATA_PATH
    assert.ok(process.env.LANJIAN_SMOKE === '1' && userData && userData === process.env.LANJIAN_SMOKE_CREATE_PARENT, 'character-atlas-requires-isolated-smoke')
    const temp = await realpath(tmpdir()), profile = await realpath(userData!)
    const inside = (root: string, target: string) => { const part = relative(root, target); return Boolean(part) && !part.startsWith('..') && !isAbsolute(part) }
    assert.ok(inside(temp, profile), 'character-atlas-profile-outside-temp')
    const status = await evaluate('window.novelDesktop.projects.status()')
    assert.equal(status?.project?.title, '烟测书稿')
    assert.ok(inside(profile, await realpath(resolve(status.project.path))), 'character-atlas-book-outside-profile')
    isolated = true
    await mkdir(output, { recursive: true })
    window.webContents.setBackgroundThrottling(false)
    window.webContents.setZoomFactor(1); window.setContentSize(1440, 900)
    stage = 'seed-formal-fixture'
    const fixture = await seed()
    const before: Chapter[] = await evaluate('window.novelDesktop.chapters.list()')
    const first = before.find(chapter => chapter.id === fixture.firstChapterId)
    const second = before.find(chapter => chapter.id === fixture.secondChapterId)
    assert.ok(first?.content.includes(fixture.characterName) && first.content.includes(fixture.firstLocation))
    assert.ok(second?.content.includes(fixture.characterName) && second.content.includes(fixture.secondLocation))
    const lines = await evaluate('window.novelDesktop.workspace.getCharacterLines()')
    assert.equal(lines.source, 'sqlite-approved-facts')
    assert.ok(lines.lines.some((line: { name: string; points: unknown[] }) => line.name === fixture.characterName && line.points.length >= 2))
    assert.ok(lines.lines.some((line: { name: string }) => line.name === fixture.secondCharacterName))
    checks.push('strict temp-profile/book isolation; two real saved chapters and approved fact histories')
    stage = 'open-cards'
    const loaded = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()))
    window.webContents.reload(); await loaded
    await waitFor(`document.querySelector('.project-library')||document.querySelector('.activitybar')`, 'renderer-ready')
    if (await evaluate(`!!document.querySelector('[data-testid="app-boot-skip"]')`)) await click('[data-testid="app-boot-skip"]')
    // Vue can already have mounted the library while the boot surface is still
    // leaving. Require its real removal and restored interactivity, not a delay
    // or manual removal of the product's loading/inert protection.
    await waitFor(`!document.querySelector('[data-testid="app-boot"]')&&!document.querySelector('[data-testid="app-boot-skip"]')&&!document.querySelector('[data-testid="workspace-loading"]')&&!document.querySelector('.app-frame[inert]')`, 'boot-transition-settled')
    if (await evaluate(`!!document.querySelector('.project-library')`)) {
      await waitFor(`(()=>{const e=document.querySelector('[data-testid="library-continue-writing"]');if(!e||e.disabled||e.closest('[inert]'))return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e),x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0&&e.contains(document.elementFromPoint(x,y))})()`, 'library-continue-genuinely-clickable')
      await click('[data-testid="library-continue-writing"]')
    }
    await waitFor(`document.querySelector('.activitybar')&&!document.querySelector('.app-frame[inert]')&&!document.querySelector('[data-testid="workspace-loading"]')`, 'workspace-settled')
    await enterAtlas()
    await click('[data-testid="atlas-search"]'); await window.webContents.insertText(fixture.characterName)
    await waitFor(`document.querySelectorAll('[data-testid="atlas-card"]').length===1`, 'searched-character')
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-testid')`), 'atlas-search')
    await click('[data-testid="atlas-card"]')
    await waitFor(`document.querySelector('[data-testid="atlas-detail"]')?.textContent.includes(${JSON.stringify(fixture.characterName)})`, 'selected-character')
    const otherSidebarIndex = await evaluate(`[...document.querySelectorAll('[data-testid="timeline-character-line"]')].findIndex(e=>e.querySelector('b')?.textContent.trim()===${JSON.stringify(fixture.secondCharacterName)})`)
    assert.ok(otherSidebarIndex >= 0, 'character-atlas-second-sidebar-character-missing')
    await click('[data-testid="timeline-character-line"]', otherSidebarIndex)
    await waitFor(`document.querySelector('[data-testid="atlas-search"]')?.value===''&&document.querySelector('[data-testid="atlas-detail"]')?.textContent.includes(${JSON.stringify(fixture.secondCharacterName)})`, 'sidebar-selection-clears-hidden-query')
    assert.ok((await evaluate(`document.querySelector('[data-testid="atlas-card"][aria-pressed="true"]')?.textContent`))?.includes(fixture.secondCharacterName), 'character-atlas-sidebar-card-selection-not-synchronized')
    checks.push('native outer sidebar selection clears the conflicting local search and opens the requested character detail')
    await capture('atlas-sidebar-selection')
    await click('[data-testid="atlas-search"]'); await window.webContents.insertText(fixture.characterName)
    await waitFor(`document.querySelectorAll('[data-testid="atlas-card"]').length===1`, 'searched-character-after-sidebar')
    await click('[data-testid="atlas-card"]')
    await waitFor(`document.querySelector('[data-testid="atlas-detail"]')?.textContent.includes(${JSON.stringify(fixture.characterName)})`, 'reselected-character-after-sidebar')
    await selectOption('[data-testid="atlas-through-chapter"]', String(first!.position ?? before.findIndex(chapter => chapter.id === fixture.firstChapterId) + 1))
    await waitFor(`document.querySelector('[data-testid="atlas-detail"]')?.textContent.includes(${JSON.stringify(fixture.firstLocation)})`, 'chapter-one-state')
    assert.ok(!(await evaluate(`document.querySelector('[data-testid="atlas-detail"]').textContent`)).includes(fixture.secondLocation), 'future-location-leaked-before-cutoff')
    await selectOption('[data-testid="atlas-location-filter"]', fixture.firstLocation)
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="atlas-card"]').length`), 1)
    await assertBounds('wide'); await capture('atlas-wide')
    checks.push('native search preserves focus; card details; chapter cutoff excludes future location; native location filter')
    stage = 'compact-zoom'
    window.setContentSize(1100, 800); await delay(300); await paint()
    window.webContents.setZoomFactor(1.25)
    await waitFor(`Math.abs(innerWidth-880)<=1&&Math.abs(innerHeight-640)<=1`, 'real-125-percent-css-viewport')
    await paint()
    assert.equal(window.webContents.getZoomFactor(), 1.25, 'character-atlas-actual-zoom-factor')
    await assertBounds('compact-125'); await capture('atlas-compact-125')
    const detailSpace = await evaluate(`document.querySelector('.atlas-detail-scroll').getBoundingClientRect().height`)
    assert.ok(detailSpace >= 128, `character-atlas-detail-space-too-small:${detailSpace}`)
    const petClear = await evaluate(`(()=>{const pet=document.querySelector('.companion-pet'),bar=document.querySelector('.studio>.statusbar');if(!pet||!bar)return true;const p=pet.getBoundingClientRect(),b=bar.getBoundingClientRect();return !p.height||!b.height||p.bottom<=b.top+1})()`)
    assert.ok(petClear, 'character-atlas-pet-obscures-statusbar')
    checks.push('1100×800 window at 125% zoom: search/cutoff/location hit tests and horizontal bounds')
    stage = 'open-source-chapter'
    await click('[data-testid="atlas-open-chapter"]')
    await waitFor(`document.querySelector('[data-testid="manuscript-title-input"]')?.value===${JSON.stringify(first!.title)}&&!document.querySelector('.app-frame[inert]')`, 'source-chapter-opened')
    await waitFor(`document.querySelector('[data-testid="manuscript-input"]')?.textContent.includes(${JSON.stringify(fixture.firstLocation)})`, 'source-prose-visible')
    assert.deepEqual(proseFingerprint(await evaluate('window.novelDesktop.chapters.list()')), proseFingerprint(before), 'atlas-navigation-mutated-prose')
    await capture('atlas-source-chapter')
    checks.push('native source-chapter open preserves all exact prose, titles, revisions and body versions')
    stage = 'tracks-roundtrip'
    window.webContents.setZoomFactor(1); window.setContentSize(1440, 900)
    await click('.activitybar [data-activity="timeline"]')
    await click('[data-testid="timeline-mode-characters"]')
    await click('[data-testid="timeline-character-tracks"]')
    await waitFor(`document.querySelector('.character-line-sheet')&&!document.querySelector('[data-testid="atlas-search"]')`, 'old-tracks')
    await capture('atlas-old-tracks')
    await click('[data-testid="timeline-character-cards"]')
    await waitFor(`document.querySelector('[data-testid="atlas-search"]')`, 'cards-returned')
    await click('[data-testid="atlas-search"]'); key('a', ['control']); await window.webContents.insertText('没有这个人物的唯一检索词')
    await waitFor(`document.querySelectorAll('[data-testid="atlas-card"]').length===0`, 'empty-search')
    await capture('atlas-empty-search')
    key('a', ['control']); key('Backspace')
    await waitFor(`document.querySelectorAll('[data-testid="atlas-card"]').length>=1`, 'search-cleared')
    assert.deepEqual(proseFingerprint(await evaluate('window.novelDesktop.chapters.list()')), proseFingerprint(before), 'atlas-roundtrip-mutated-prose')
    checks.push('cards/legacy tracks roundtrip; real empty search and recovery; unchanged manuscript after all controls')
    const result = { ok: true, checks, screenshots, layouts }
    await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    if (isolated) await capture('failure').catch(() => undefined)
    const result = { ok: false, stage, error: error instanceof Error ? error.message : String(error), checks, screenshots, layouts }
    if (isolated) await writeFile(join(output, 'verification.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    if (isolated) { window.webContents.setZoomFactor(originalZoom); window.setBounds(originalBounds); window.webContents.setBackgroundThrottling(originalThrottle) }
  }
}
