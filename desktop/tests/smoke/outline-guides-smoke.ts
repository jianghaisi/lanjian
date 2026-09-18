import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

/** Runs only inside the isolated editor-parity fixture, never an author's book. */
export async function runOutlineGuidesSmoke(window: BrowserWindow, capturePath?: string): Promise<void> {
  const js = (source: string) => window.webContents.executeJavaScript(source)
  const wait = () => new Promise(resolve => setTimeout(resolve, 250))
  const capture = async (suffix: string) => {
    if (capturePath) await writeFile(capturePath.replace('.png', `-guides-${suffix}.png`), (await window.capturePage()).toPNG())
  }
  // Ctrl+S persists before its UI refresh completes. Wait for the newly mounted,
  // editable chapter surface instead of typing into the outgoing read-only view.
  await js(`window.__parityUntil(() => {
    const content = document.querySelector('.outline-writing-paper .cm-content[aria-label="当前章纲正文"]')
    return content?.checkVisibility() && content.isContentEditable
      && document.querySelector('.outline-statusbar')?.textContent.includes('SQLite')
      && !document.querySelector('.outline-statusbar')?.textContent.includes('有改动待保存')
  })`)
  await js(`document.querySelector('.outline-writing-paper .cm-content[aria-label="当前章纲正文"]').focus()`)
  window.focus(); window.webContents.focus()
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] })
  await wait()
  await window.webContents.insertText('\n' + Array.from({ length: 60 }, (_, i) =>
    `第 ${i + 1} 场：人物沿街寻找线索。` + '这是一段用于检查自动折行与横线对齐的章纲，不修改真实作品。'.repeat(4)
  ).join('\n\n'))
  await wait()
  const originalZoom = window.webContents.getZoomFactor()
  try {
    for (const zoom of [1, 1.25]) {
      window.webContents.setZoomFactor(zoom)
      await wait()
      for (const scroll of [0, 613, 6007]) {
        // Zoom changes wrapped-line measurements in CodeMirror's virtual viewport.
        // Its scroll anchoring can adjust the first requested offset after measuring;
        // settle at the exact target before asserting the ruled-paper phase.
        for (let attempt = 0; attempt < 5; attempt++) {
          await js(`document.querySelector('.cm-content[aria-label="当前章纲正文"]').closest('.cm-scroller').scrollTop = ${scroll}`)
          await wait()
          const settled = await js(`Math.abs(document.querySelector('.cm-content[aria-label="当前章纲正文"]').closest('.cm-scroller').scrollTop - ${scroll}) < 1`)
          if (settled) break
        }
        const result = await js(`(() => {
          const content = document.querySelector('.cm-content[aria-label="当前章纲正文"]')
          const paper = content.closest('.outline-writing-paper')
          const scroller = content.closest('.cm-scroller')
          const style = getComputedStyle(content)
          const period = parseFloat(style.backgroundSize.split(' ')[1])
          const lineHeight = parseFloat(style.lineHeight)
          const origin = content.getBoundingClientRect().top + parseFloat(style.backgroundPositionY)
          const lines = Array.from(content.querySelectorAll('.cm-line')).filter(line => {
            const r = line.getBoundingClientRect(), s = scroller.getBoundingClientRect()
            return r.bottom > s.top && r.top < s.bottom
          })
          const singleLayer = [paper, content.parentElement, scroller].every(e => getComputedStyle(e).backgroundImage === 'none')
          const aligned = lines.every(line => {
            const r = line.getBoundingClientRect()
            const phase = (r.bottom - origin) / period
            return Math.abs(phase - Math.round(phase)) * period < 1
          })
          return { singleLayer, aligned, visibleLines: lines.length, period, lineHeight, scrollTop: scroller.scrollTop,
            hasRules: style.backgroundImage.includes('repeating-linear-gradient'), wrapped: lines.some(line => line.getBoundingClientRect().height > lineHeight * 1.5),
            contentLength: content.textContent.length, contentRect: content.getBoundingClientRect().toJSON(), scrollRect: scroller.getBoundingClientRect().toJSON() }
        })()`)
        await capture(`${zoom}-${scroll}`)
        if (!result.singleLayer || !result.aligned || !result.hasRules || result.visibleLines < 2 || !result.wrapped
          || Math.abs(result.period - result.lineHeight) > 0.1 || Math.abs(result.scrollTop - scroll) > 1) {
          throw new Error('outline rules are duplicated or out of phase: ' + JSON.stringify(result))
        }
        console.info('[outline guides smoke]', JSON.stringify({ zoom, ...result }))
      }
    }
    // Exercise the existing appearance class without changing the author's profile.
    await js(`document.querySelector('.studio').classList.add('editor-guides-hidden')`)
    await wait()
    const hidden = await js(`Array.from(document.querySelectorAll('.outline-writing-paper, .outline-writing-paper .cm-scroller, .outline-writing-paper .cm-content')).every(e => getComputedStyle(e).backgroundImage === 'none')`)
    await capture('hidden')
    if (!hidden) throw new Error('outline rules remain visible when disabled')
  } finally {
    await js(`document.querySelector('.studio').classList.remove('editor-guides-hidden')`)
    window.webContents.setZoomFactor(originalZoom)
  }
}
