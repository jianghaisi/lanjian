import type { ObjectDirective } from 'vue'
const cleanups = new WeakMap<HTMLElement, () => void>()
/** Modal keyboard boundary, scoped to the mounted dialog and its actual controls. */
export const dialogFocus: ObjectDirective<HTMLElement, () => void> = {
  mounted(element, binding) {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controls = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length)
    element.tabIndex = -1
    queueMicrotask(() => { (controls()[0] ?? element).focus() })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); binding.value() }
      if (event.key === 'Tab') { const items = controls(), first = items[0], last = items.at(-1)
        if (!first || !last) { event.preventDefault(); element.focus() }
        else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    cleanups.set(element, () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() })
  },
  unmounted(element) { cleanups.get(element)?.(); cleanups.delete(element) }
}
