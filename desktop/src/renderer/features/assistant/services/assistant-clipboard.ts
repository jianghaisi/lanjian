/** Explicit author copy only; the desktop session may deny browser clipboard permissions. */
export async function copyAssistantText(text: string, current: () => boolean = () => true): Promise<boolean> {
  if (!current()) return false
  try { await navigator.clipboard.writeText(text) }
  catch {
    // Do not steal focus or overwrite the clipboard after the author changes records/books.
    if (!current()) return false
    const previous = document.activeElement, selection = window.getSelection()
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
    const input = document.createElement('textarea')
    input.value = text; input.readOnly = true; input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true'); input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0'
    // A top-layer dialog makes document.body inert; use its active subtree when present.
    const parent = previous instanceof HTMLElement ? previous.closest('dialog[open]') || document.body : document.body
    parent.append(input)
    try { input.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable') }
    finally {
      input.remove()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
      if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range) }
    }
  }
  return current()
}
