import type { InteractionCue } from '../../ui/interaction-feedback'

export function soundControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const control = target.closest<HTMLElement>('button,a[href],summary,input[type="checkbox"],input[type="radio"],[role="tab"],[role="switch"]')
  if (!control || control.matches(':disabled,[aria-disabled="true"]') || control.closest('[inert],[data-sound="none"],[contenteditable="true"],.titlebar,.window-controls')
    || !control.getClientRects().length) return null
  return control
}
export function controlCue(control: HTMLElement): InteractionCue | null {
  const explicit = control.dataset.sound
  if (['click', 'confirm', 'back', 'navigate', 'on', 'off', 'open', 'close'].includes(explicit ?? '')) return explicit as InteractionCue
  if (control.matches('input[type="checkbox"],input[type="radio"],[role="switch"]')) return null // actual change owns these
  if (control.tagName === 'SUMMARY') return control.closest('details')?.open ? 'close' : 'open'
  if (control.matches('[role="tab"],[data-nav-leaf]') || control.closest('nav')) {
    if (control.getAttribute('aria-selected') === 'true' || control.hasAttribute('aria-current')) return null
    return 'navigate'
  }
  if (control instanceof HTMLButtonElement && control.form && control.type === 'submit') return 'confirm'
  return 'click'
}

export function installSoundEvents(doc: Document, options: {
  play: (cue: InteractionCue) => void
  hover: () => void
  activate: () => void
  unlock: () => void
  hide: () => void
}) {
  const pending = new Set<ReturnType<typeof setTimeout>>()
  function click(event: MouseEvent) {
    if (!event.isTrusted || event.button !== 0) return
    options.activate(); options.unlock()
    const control = soundControl(event.target)
    if (!control) return
    const wasChecked = control.getAttribute('aria-checked')
    const cue = controlCue(control)
    // Vue's action and panel lifecycle run first. A dedicated panel cue wins the shared throttle.
    const timer = setTimeout(() => {
      pending.delete(timer)
      if (doc.hidden) return
      if (control.matches('[role="switch"]')) {
        const checked = control.getAttribute('aria-checked')
        if (checked !== wasChecked) options.play(checked === 'true' ? 'on' : 'off')
      } else if (cue) options.play(cue)
    }, 0)
    pending.add(timer)
  }
  function change(event: Event) {
    if (!event.isTrusted) return
    const control = soundControl(event.target)
    if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) options.play(control.checked ? 'on' : 'off')
  }
  function hover(event: PointerEvent) {
    if (!event.isTrusted || event.pointerType === 'touch') return
    const control = soundControl(event.target)
    if (control && !(event.relatedTarget instanceof Node && control.contains(event.relatedTarget))) options.hover()
  }
  function key(event: KeyboardEvent) {
    if (!event.isTrusted || event.isComposing || event.repeat) return
    if (['Enter', ' ', 'Escape'].includes(event.key) && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) {
      options.activate(); options.unlock()
    }
  }
  function visibility() {
    if (doc.hidden) {
      pending.forEach(clearTimeout); pending.clear(); options.hide()
    }
  }
  function toggle(event: Event) {
    if (!(event.target instanceof HTMLDialogElement) || !event.target.matches('[data-sound-dialog]')) return
    options.play(event.target.open ? 'open' : 'close')
  }
  doc.addEventListener('click', click, true)
  doc.addEventListener('change', change, true)
  doc.addEventListener('pointerover', hover, true)
  doc.addEventListener('keydown', key, true)
  doc.addEventListener('visibilitychange', visibility)
  doc.addEventListener('toggle', toggle, true)
  return () => {
    pending.forEach(clearTimeout); pending.clear()
    doc.removeEventListener('click', click, true)
    doc.removeEventListener('change', change, true)
    doc.removeEventListener('pointerover', hover, true)
    doc.removeEventListener('keydown', key, true)
    doc.removeEventListener('visibilitychange', visibility)
    doc.removeEventListener('toggle', toggle, true)
  }
}
