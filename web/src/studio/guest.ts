import { record, text } from '@lanjian/hosted-contracts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import { http } from '../api/http'

export const guestMode = new URLSearchParams(location.search).get('guest') === '1'
export const guestNotice = (operation = '') => { throw Object.assign(new Error('游客模式只能查看，登录后即可创建自己的作品。'), { code: 'FEATURE_UNAVAILABLE', recoverable: true, operation }) }
export async function guestDesktop() {
  const snapshot = record(await http.request('/api/guest-reference'))
  const responses = record(snapshot.responses), id = text(snapshot.bookId, 100)
  return { id, invoke<T>(channel: string, args: unknown[]): T {
    if (channel === 'projects:switch' && args[0] === id) return { success: true, path: id } as T
    if (channel === 'model-connections:leaveBook') return true as T
    const key = JSON.stringify([channel, args.map(value => value === undefined ? null : value)])
    const response = responses[key] ?? (args.every(value => value === undefined || value === null) ? responses[JSON.stringify([channel, []])] : undefined)
    if (response === undefined) return guestNotice(channel)
    return unwrapValidatedIpcResponse<T>(channel, structuredClone(response))
  } }
}

/** Presentation lock for the reused native forms. The server remains auth-only for writes. */
export function lockGuestEditors() {
  document.documentElement.dataset.guest = 'true'
  const editable = 'textarea,input:not([type=search]):not([type=button]):not([type=submit]),select,[contenteditable]'
  function isSearch(element: Element) { return !!element.closest('.library-search,.search-bar,.manuscript-find') || /搜索|查找/.test(element.getAttribute('placeholder') || '') }
  function lock(element: Element) {
    if (isSearch(element)) return
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      if (!element.readOnly) element.readOnly = true
      if (element instanceof HTMLInputElement && ['checkbox','radio','range','file','color'].includes(element.type)) element.disabled = true
    } else if (element instanceof HTMLSelectElement) element.disabled = true
    else if (element.getAttribute('contenteditable') === 'true') element.setAttribute('contenteditable', 'false')
  }
  const scan = () => document.querySelectorAll(editable).forEach(lock)
  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] })
  document.addEventListener('beforeinput', event => { if (event.target instanceof Element && !isSearch(event.target)) event.preventDefault() }, true)
  document.addEventListener('submit', event => event.preventDefault(), true)
  scan()
}
