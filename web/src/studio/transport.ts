/// <reference path="../../../desktop/src/renderer/desktop.d.ts" />
import { createDesktopApi } from '../../../desktop/src/contracts/core/create-desktop-api'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import { defaultCompanionSettings, decodeCompanionSettings, decodeCompanionSettingsPatch } from '../../../desktop/src/contracts/companion/companion-settings'
import { ApiError, http } from '../api/http'
import { decodeBook } from '@lanjian/hosted-contracts'
import { importDocuments, exportManuscript } from './files'
import { guestMode, guestDesktop } from './guest'

const unavailable = (message = '在线版不运行本地文字或语音模型；立绘与预设陪伴可以继续使用。'): never => {
  throw { code: 'FEATURE_UNAVAILABLE', message, recoverable: true }
}

export async function installBrowserDesktop() {
  const guest = guestMode ? await guestDesktop() : null
  if (guest) {
    const destination = new URL(location.href)
    destination.searchParams.set('book', guest.id)
    history.replaceState(null, '', destination.pathname + destination.search + destination.hash)
  }
  const session = guest ? null : await http.me()
  let book: string | null = null
  http.onExpired = guest ? () => undefined : () => location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  const companionKey = `lanjian-online-companion:${session?.user.id ?? 'guest'}`
  let companion = defaultCompanionSettings()
  const saved = localStorage.getItem(companionKey)
  if (saved) companion = decodeCompanionSettings(JSON.parse(saved))
  companion.voice = { ...companion.voice, mute: true, textModel: false, preload: false }
  companion.microphone = { ...companion.microphone, enabled: false }
  const listeners = new Set<(value: typeof companion) => void>()
  window.companionSettings = {
    get: async () => structuredClone(companion),
    importVoice: async voice => {
      if (!saved) {
        const patch = decodeCompanionSettingsPatch({ voice })
        companion.voice = { ...companion.voice, ...patch.voice, mute: true, textModel: false, preload: false }
        localStorage.setItem(companionKey, JSON.stringify(companion))
      }
      return structuredClone(companion)
    },
    update: async patch => {
      const checked = decodeCompanionSettingsPatch(patch)
      if (checked.voice?.mute === false || checked.voice?.textModel || checked.voice?.preload || checked.microphone?.enabled) unavailable()
      companion = decodeCompanionSettings({ ...companion, ...checked, voice: { ...companion.voice, ...checked.voice }, revision: companion.revision + 1 })
      localStorage.setItem(companionKey, JSON.stringify(companion))
      for (const listener of listeners) listener(structuredClone(companion))
      return structuredClone(companion)
    },
    recover: async () => structuredClone(companion),
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener) }
  }
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    if (guest) { if (channel === 'local-models:list') return [] as T; return guest.invoke<T>(channel, args) }
    if (['imports:choose-text', 'imports:choose-documents', 'imports:append-documents', 'projects:manuscript-export'].includes(channel)) {
      const captured = book
      if (!captured) unavailable('请先打开一部作品。')
      if (channel === 'projects:manuscript-export') return await exportManuscript(captured!, args[0]) as T
      const result = await importDocuments(captured!, channel === 'imports:choose-text' ? 'single' : channel === 'imports:choose-documents' ? 'multiple' : 'append', args[0] as string | undefined)
      if (book !== captured) unavailable('作品已切换，请在原作品中重新导入。')
      return result as T
    }
    if (['projects:open-trash', 'projects:trash', 'projects:remove-recent'].includes(channel)) unavailable('网页版暂时没有这个功能。')
    if (channel === 'projects:switch') {
      const id = String(args[0])
      await http.request(`/api/desktop/library/open`, 'POST', { id })
      book = id
      return { success: true, path: id } as T
    }
    if (channel === 'model-connections:leaveBook') { book = null; return true as T }
    if (channel === 'projects:choose-directory') return '账户书库' as T
    if (channel === 'local-models:list') return [] as T
    const captured = book
    const library = channel.startsWith('inspiration:') || channel.startsWith('group-chat:') || channel === 'projects:list' || channel === 'projects:trash' || channel === 'ai:background-tasks' || ['model-connections:defaults', 'model-connections:previewCreation', 'model-connections:createProject', 'model-connections:cancelPreviews', 'model-connections:cancelTest'].includes(channel)
    const scope = captured && !library ? `/api/books/${captured}/desktop` : '/api/desktop/library'
    const response = await http.request(`${scope}/${channel.split(':').map(encodeURIComponent).join('/')}`, 'POST', { args, operation: crypto.randomUUID() })
    const result = unwrapValidatedIpcResponse<T>(channel, response)
    if (channel === 'model-connections:createProject' && result && typeof result === 'object' && 'status' in result && result.status === 'created' && 'project' in result) {
      book = (result.project as { id: string }).id
    }
    if (channel === 'group-chat:createBook') { const created = (result as { result: { status: string; project?: { id: string } } }).result; if (created.status === 'created') book = created.project!.id }
    return result
  }
  window.novelDesktop = createDesktopApi(invoke, {
    app: {
      platform: 'browser',
      hosted: {
        readOnly: Boolean(guest),
        account: async () => { if (guest) return { name: '游客', balance: 0, reserved: 0, admin: false }; const current = await http.me(); return { name: current.user.name, balance: current.wallet.balance, reserved: current.wallet.reserved, admin: current.user.role === 'admin' } },
        logout: async () => { if (http.session) await http.logout(); location.assign('/login') },
        referenceSession: async () => { try { await http.me(); return { authenticated: true } } catch (error) { if (error instanceof ApiError && error.status === 401) return { authenticated: false }; throw error } },
        copyReference: async () => { const value = decodeBook(await http.request('/api/reference-book/copy', 'POST', {})); return `/app?book=${encodeURIComponent(value.id)}` },

      },
      version: async () => '0.1.0-web',
      onWindowShown: listener => { queueMicrotask(listener); return () => undefined },
      // Desktop close handlers cancel local tasks. Browser navigation must leave
      // server jobs running; the renderer's blur/visibility autosave stays active.
      onBeforeClose: () => () => undefined,
      readyToClose: () => undefined,
      showSelectionAiMenu: () => unavailable('请使用编辑器中的 AI 编辑菜单。'),
      onSelectionAiAction: () => () => undefined
    },
    companionVoice: {
      status: async () => ({ installed: false, textInstalled: false, speechInstalled: false, profile: 'gpt-sovits-v2-fp16' }),
      configure: async options => { if (options.textModel || options.speechModel) unavailable(); return true },
      suspend: async () => true,
      warmup: async () => unavailable(), prepare: async () => unavailable(), open: async () => unavailable(), request: async () => unavailable(),
      cancel: async () => false, close: async () => true,
      onReset: () => () => undefined, onEvent: () => () => undefined
    }
  })
}
