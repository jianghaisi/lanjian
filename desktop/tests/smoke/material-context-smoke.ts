import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Focused renderer proof for relevant material -> exclude -> pin without covering prose. */
export async function runMaterialContextSmoke(window: BrowserWindow, capturePath?: string): Promise<SmokeResult> {
  const pinned = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, attempts = 100) => {
      for (let index = 0; index < attempts; index += 1) {
        const value = await read()
        if (value) return value
        await wait()
      }
      return null
    }
    const openChapter = async (title) => {
      const target = Array.from(document.querySelectorAll('.tree-item')).find(item => item.textContent?.includes(title))
      target?.click()
      return until(() => {
        const editor = document.querySelector('[data-testid="manuscript-editor"]')
        const input = document.querySelector('[data-testid="manuscript-title-input"]')
        return editor && input?.value?.includes(title) ? editor : null
      })
    }
    const openAssistant = async () => {
      if (!document.querySelector('[data-testid="assistant-sidebar"]')) {
        document.querySelector('[aria-label="打开智能助笔侧栏"]')?.click()
      }
      const assistant = await until(() => document.querySelector('[data-testid="assistant-sidebar"]'))
      document.querySelector('[data-testid="assistant-mode-checks"]')?.click()
      const checks = await until(() => {
        const page = document.querySelector('[data-testid="assistant-check-page"]')
        return page && window.getComputedStyle(page).display !== 'none' ? page : null
      })
      return assistant && checks ? assistant : null
    }
    const openPack = async () => {
      const pack = await until(() => document.querySelector('[data-testid="context-fact-pack"]'))
      if (pack && !pack.open) pack.querySelector('summary')?.click()
      await wait(120)
      return pack
    }
    let currentStep = 'initialize'
    try {
      currentStep = 'open-manuscript'
      document.querySelector('[aria-label="书稿"]')?.click()
      if (!await openChapter('雨夜追迹')) return { ok: false, step: 'manuscript-missing' }
      if (!await openAssistant()) return { ok: false, step: 'assistant-missing' }
      let pack = await openPack()
      if (!pack) return { ok: false, step: 'context-pack-missing' }

      currentStep = 'material-visible'
      const first = await until(() => pack.querySelector('[data-material-source-id]'))
      if (!first || !first.textContent?.includes('酒馆后巷红泥')) return { ok: false, step: 'relevant-material-missing', text: pack.textContent }
      const sourceId = first.getAttribute('data-material-source-id')
      const key = first.querySelector('[data-material-evidence-key]')?.getAttribute('data-material-evidence-key')
      if (!sourceId || !key) return { ok: false, step: 'material-identity-missing' }

      currentStep = 'pin-material'
      first.querySelector('[data-material-evidence-key]')?.click()
      const pinned = await until(async () => {
        const current = await window.novelDesktop.workspace.getContextBudgetPreferences()
        const row = document.querySelector('[data-material-source-id="' + sourceId + '"]')
        return current.pinnedEvidenceKeys.includes(key) && row?.textContent?.includes('作者固定') && row.querySelector('[data-material-evidence-key]')?.textContent?.includes('已固定')
      })
      if (!pinned) return { ok: false, step: 'material-pin-failed' }
      await wait(700)
      pack = await openPack()
      const pinnedRow = await until(() => document.querySelector('[data-material-source-id="' + sourceId + '"]'))
      if (!pack || !pinnedRow) return { ok: false, step: 'material-pin-refresh-missing' }
      const ledger = pinnedRow.closest('.context-source-ledger')
      if (ledger) ledger.scrollTop = Math.max(0, pinnedRow.offsetTop - ledger.clientHeight / 2)
      const checksPage = document.querySelector('[data-testid="assistant-check-page"]')
      if (checksPage) checksPage.scrollTop = Math.max(0, pack.offsetTop - 12)
      await wait(300)

      currentStep = 'layout'
      const editor = document.querySelector('[data-testid="manuscript-editor"]')?.getBoundingClientRect()
      const assistant = document.querySelector('[data-testid="assistant-sidebar"]')?.getBoundingClientRect()
      const resizer = document.querySelector('[aria-label="调整智能助笔侧栏宽度"]')
      const noOverlap = Boolean(editor && assistant && editor.right <= assistant.left + 1 && editor.width >= 420)
      return {
        ok: Boolean(pinned && noOverlap && resizer),
        step: 'material-visible-and-pinned',
        sourceId,
        key,
        editorWidth: editor?.width || 0,
        assistantWidth: assistant?.width || 0,
        noOverlap,
        resizerVisible: Boolean(resizer)
      }
    } catch (error) {
      return { ok: false, step: 'material-context-exception', currentStep, error: error?.message || JSON.stringify(error), details: error?.details || null }
    }
  })()`)
  if (!pinned.ok) return pinned
  if (capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  const evidenceKey = JSON.stringify(String(pinned.key))
  const sourceIdentity = JSON.stringify(String(pinned.sourceId))
  const excluded = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
    const key = ${evidenceKey}
    const sourceId = ${sourceIdentity}
    const button = document.querySelector('[data-material-source-id="' + sourceId + '"] [data-exclude-material-key]')
    if (!button) return { ok: false, step: 'material-exclude-button-missing' }
    button.click()
    for (let index = 0; index < 100; index += 1) {
      const preferences = await window.novelDesktop.workspace.getContextBudgetPreferences()
      if (preferences.excludedEvidenceKeys.includes(key) && !document.querySelector('[data-material-source-id="' + sourceId + '"]')) {
        return { ok: true, step: 'material-excluded' }
      }
      await wait()
    }
    return { ok: false, step: 'material-exclusion-failed' }
  })()`)
  return excluded.ok ? { ...pinned, step: 'material-visible-pinned-and-excluded', exclusionVerified: true } : { ...excluded, pinned }
}
