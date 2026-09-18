import type { BrowserWindow, InputEvent } from 'electron'
import { writeFile } from 'node:fs/promises'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
type Result = { ok: boolean; step: string; [key: string]: unknown }

export async function runEditorParitySmoke(window: BrowserWindow, capturePath?: string): Promise<Result> {
  if (process.env.LANJIAN_SMOKE_EDITOR_COMPACT === '1') {
    window.setSize(1100, 800)
    capturePath = capturePath?.replace('.png', '-compact.png')
  }
  const js = async <T = unknown>(source: string): Promise<T> => {
    const result = await window.webContents.executeJavaScript(`(async () => { try { return await (${source}) } catch (error) { return { __parityError: error.message } } })()`)
    if (result && typeof result === 'object' && '__parityError' in result) throw new Error(result.__parityError)
    return result
  }
  const press = async (keyCode: string, modifiers: NonNullable<InputEvent['modifiers']> = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await wait(100)
  }
  const fixture = await js<{ volume: number; stage: number }>(`(async () => {
    localStorage.setItem('lanjian-opening-enabled', 'false')
    sessionStorage.setItem('lanjian-opening-seen', 'true')
    if (${JSON.stringify(process.env.LANJIAN_SMOKE_OUTLINE_GUIDES === '1')}) {
      localStorage.setItem('lanjian-editor-guide-lines', 'true')
    }
    const profile = await window.novelDesktop.workspace.getBookProfile()
    await window.novelDesktop.workspace.saveBookProfile({ ...profile, autosaveEnabled: false })
    let planning = await window.novelDesktop.outlines.planningStatus(1)
    if (!planning.volumes.length) planning = await window.novelDesktop.outlines.createVolume('核验卷')
    const volume = planning.volumes[0].volume
    await window.novelDesktop.outlines.update('total', '总纲核验：人物抵达旧城。')
    await window.novelDesktop.outlines.update(volume, '卷纲核验：沿街寻找线索。')
    const result = await window.novelDesktop.outlines.createStage(volume, '编辑等价核验阶段')
    await window.novelDesktop.outlines.updateStage(result.stage.stage, result.stage.title, '阶段核验：在钟楼找到铜铃。')
    await window.novelDesktop.outlines.placeChapterInStage(1, result.stage.stage, volume)
    await window.novelDesktop.chapterOutlines.update(1, '章纲核验：推门后听见回应。')
    return { volume, stage: result.stage.stage }
  })()`)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('editor parity reload timeout')), 15000)
    window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
    window.webContents.reload()
  })
  await js(`(async () => {
    window.__parityKeys = []
    document.addEventListener('keydown', event => {
      window.__parityKeys.push({ key: event.key, composing: event.isComposing, target: event.target?.getAttribute?.('aria-label') })
      window.__parityKeys = window.__parityKeys.slice(-8)
    }, true)
    window.__parityUntil = async read => { for (let i = 0; i < 150; i++) { if (await read()) return true; await new Promise(r => setTimeout(r, 80)) }; throw new Error('editor parity wait timed out') }
    window.__parityClick = async selector => {
      await window.__parityUntil(() => { const e = document.querySelector(selector); return e && e.checkVisibility() && !e.disabled })
      const e = document.querySelector(selector); e.scrollIntoView({ block: 'center' }); e.click()
      await new Promise(r => setTimeout(r, 160))
    }
    await window.__parityUntil(() => document.querySelector('[data-activity="desk"]') || document.querySelector('.work-item-open'))
    if (!document.querySelector('[data-activity="desk"]')) Array.from(document.querySelectorAll('.work-item-open')).find(e => e.getAttribute('aria-label')?.includes('烟测书稿')).click()
    await window.__parityClick('[data-activity="desk"]')
  })()`)
  const documents = [
    { id: 'manuscript', label: '章节正文', navigate: `await window.__parityClick('[data-activity="desk"]')`, read: '(await window.novelDesktop.chapters.get(1)).content' },
    { id: 'total', label: '全局总纲正文', navigate: `await window.__parityClick('[aria-label="谋篇"]'); Array.from(document.querySelectorAll('.tree-item')).find(e => e.textContent.includes('全局总纲')).click()`, read: "(await window.novelDesktop.outlines.get('total')).content" },
    { id: 'volume', label: '当前卷纲正文', navigate: `document.querySelector('[aria-label="展开第 ${fixture.volume} 卷"]')?.click(); await window.__parityClick('.outline-volume-outline')`, read: `(await window.novelDesktop.outlines.get(${fixture.volume})).content` },
    { id: 'stage', label: '当前阶段纲正文', navigate: `await window.__parityClick('[data-testid="open-stage-${fixture.stage}"]')`, read: `(await window.novelDesktop.outlines.list()).stages.find(s => s.stage === ${fixture.stage}).content` },
    { id: 'chapter', label: '当前章纲正文', navigate: `await window.__parityClick('.outline-stage-node .stage-chapter')`, read: '(await window.novelDesktop.chapterOutlines.get(1)).content' }
  ]
  const evidence: Array<{ document: string; expected: string }> = []
  for (const doc of documents) {
    console.info('[editor parity smoke] document: ' + doc.id)
    const selector = `.cm-content[aria-label="${doc.label}"]`
    const baseline = await js<string>(`(async () => { ${doc.navigate}; await window.__parityUntil(() => document.querySelector(${JSON.stringify(selector)})?.checkVisibility()); return ${doc.read} })()`)
    const rendered = () => js<string>(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.cm-line')).map(e => e.textContent).join('\\n')`)
    if (!baseline.trim() || await rendered() !== baseline) return { ok: false, step: doc.id + '-baseline-mismatch' }
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    window.focus(); window.webContents.focus()
    await press('z', ['control'])
    if (await rendered() !== baseline) return { ok: false, step: doc.id + '-inherited-other-document-history' }
    await press('End', ['control'])
    const suffix = '\n编辑核验追加：保持人物与事件顺序。'
    await window.webContents.insertText(suffix)
    await wait(200)
    // Manuscript's enabled first-line layout adds its documented two-character indent;
    // structured outlines intentionally preserve plain text without novel paragraph formatting.
    const expected = (doc.id === 'manuscript' && !baseline.startsWith('　　') ? '　　' : '') + baseline + suffix
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-native-input-mismatch', actual: await rendered() }
    await press('z', ['control'])
    if (await rendered() !== baseline) return { ok: false, step: doc.id + '-undo-mismatch' }
    await press('y', ['control'])
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-redo-mismatch' }
    await press('s', ['control'])
    console.info('[editor parity smoke] save: ' + doc.id)
    await js(`window.__parityUntil(async () => ${doc.read} === ${JSON.stringify(expected)})`)
    if (doc.id !== 'manuscript') await js(`window.__parityUntil(() => document.querySelector('.outline-statusbar')?.textContent.includes('SQLite') && !document.querySelector('.outline-statusbar')?.textContent.includes('有改动待保存'))`)
    await press('f', ['control'])
    console.info('[editor parity smoke] find: ' + doc.id)
    const searchSelector = doc.id === 'manuscript' ? '.manuscript-find input[aria-label="查找正文"]' : '.cm-search input[name="search"]'
    await js(`window.__parityUntil(() => document.querySelector(${JSON.stringify(searchSelector)})?.checkVisibility())`)
    await js(`document.querySelector(${JSON.stringify(searchSelector)}).focus()`)
    await window.webContents.insertText('核验')
    await wait(150)
    if (!await js<boolean>(`document.activeElement === document.querySelector(${JSON.stringify(searchSelector)})`)) return { ok: false, step: doc.id + '-search-stole-input-focus' }
    // insertText doesn't synthesize the IME keyup used by CodeMirror's native panel.
    // Tab commits the native field through blur/change before Enter selects a match.
    await press('Tab')
    await js(`document.querySelector(${JSON.stringify(searchSelector)}).focus()`)
    await press('Enter')
    const matchResult = await js<string>(`document.querySelector(${JSON.stringify(doc.id === 'manuscript' ? '.manuscript-find .match-count' : '.cm-searchMatch')})?.textContent || ''`)
    if (!matchResult || matchResult.includes('没有匹配')) return { ok: false, step: doc.id + '-search-match-missing' }
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-search-enter-edited-manuscript' }
    if (doc.id !== 'manuscript') {
      const translated = await js<boolean>(`(() => {
        const panel = document.querySelector('.cm-search')
        const labels = ['上一处', '下一处', '替换这一处', '全部替换', '区分大小写', '正则表达式', '全词匹配']
        const fields = Array.from(panel.querySelectorAll('input, button'))
        const bounds = document.querySelector(${JSON.stringify(selector)}).closest('.plain-text-editor').getBoundingClientRect()
        return labels.every(label => panel.textContent.includes(label)) && panel.querySelector('[aria-label="查找内容"]') && panel.querySelector('[aria-label="关闭查找"]')
          && fields.every(field => { const r = field.getBoundingClientRect(); return r.width > 0 && r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom })
      })()`)
      if (!translated) return { ok: false, step: doc.id + '-search-labels-or-controls-clipped' }
    }
    if (capturePath) await writeFile(capturePath.replace('.png', '-' + doc.id + '-search.png'), (await window.capturePage()).toPNG())
    const replacementSelector = doc.id === 'manuscript' ? '.manuscript-find input[aria-label="替换为"]' : '.cm-search input[name="replace"]'
    await js(`document.querySelector(${JSON.stringify(replacementSelector)}).focus()`)
    await window.webContents.insertText('验证')
    await press('Tab') // Commit the library's replacement field through its native blur/change path.
    const replaceButton = doc.id === 'manuscript' ? `Array.from(document.querySelectorAll('.manuscript-find button')).find(e => e.textContent === '替换')` : `document.querySelector('.cm-search button[name="replace"]')`
    await js(`${replaceButton}.click()`)
    await wait(150)
    const replaced = await rendered()
    if (replaced === expected || replaced.split('验证').length !== expected.split('验证').length + 1 || replaced.replace('验证', '核验') !== expected) return { ok: false, step: doc.id + '-replace-current-mismatch', actual: replaced }
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    await press('z', ['control'])
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-replace-undo-mismatch' }
    await press('y', ['control'])
    if (await rendered() !== replaced) return { ok: false, step: doc.id + '-replace-redo-mismatch' }
    await press('z', ['control'])
    const replaceAllButton = doc.id === 'manuscript' ? `Array.from(document.querySelectorAll('.manuscript-find button')).find(e => e.textContent === '全部替换')` : `document.querySelector('.cm-search button[name="replaceAll"]')`
    await js(`${replaceAllButton}.click()`)
    await wait(150)
    if (await rendered() !== expected.replaceAll('核验', '验证')) return { ok: false, step: doc.id + '-replace-all-mismatch' }
    await js(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    await press('z', ['control'])
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-replace-all-undo-mismatch' }
    await press('s', ['control'])
    await js(`window.__parityUntil(async () => ${doc.read} === ${JSON.stringify(expected)})`)
    await press('Escape')
    if (await js<boolean>(`Boolean(document.querySelector(${JSON.stringify(searchSelector)})?.checkVisibility())`)) {
      let captureError: string | undefined
      if (capturePath) {
        try { await writeFile(capturePath.replace('.png', '-' + doc.id + '-search-close-failed.png'), (await window.capturePage()).toPNG()) }
        catch (error) { captureError = error instanceof Error ? error.message : 'Capture unavailable' }
      }
      const focus = await js(`(()=>{const e=document.activeElement;const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {tag:e?.tagName,label:e?.getAttribute('aria-label'),editable:e?.getAttribute('contenteditable'),classes:e?.className,searchPanels:document.querySelectorAll('.cm-search,.manuscript-find').length,documentFocused:document.hasFocus(),keys:window.__parityKeys,layers:Array.from(document.querySelectorAll('.modal-backdrop,dialog[open],[aria-modal="true"]')).map(e=>({classes:e.className,testId:e.getAttribute('data-testid'),box:box(e),children:Array.from(e.children).slice(0,3).map(c=>({tag:c.tagName,classes:c.className,box:box(c)}))}))};})()`)
      return { ok: false, step: doc.id + '-search-did-not-close', focus, captureError }
    }
    if (await rendered() !== expected) return { ok: false, step: doc.id + '-search-close-edited-manuscript' }
    evidence.push({ document: doc.id, expected })
  }
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  if (process.env.LANJIAN_SMOKE_OUTLINE_GUIDES === '1') {
    const { runOutlineGuidesSmoke } = await import('./outline-guides-smoke')
    await runOutlineGuidesSmoke(window, capturePath)
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('editor parity saved reload timeout')), 15000)
    window.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
    window.webContents.reload()
  })
  for (const [index, doc] of documents.entries()) {
    const stored = await js<string>(`(async () => ${doc.read})()`)
    if (stored !== evidence[index].expected) return { ok: false, step: doc.id + '-later-editor-overwrote-earlier-document' }
  }
  return { ok: true, step: 'five-editors-native-input-undo-redo-search-replace-save-isolated', documents: evidence.map(item => item.document), reloaded: true }
}
