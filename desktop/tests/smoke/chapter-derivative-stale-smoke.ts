import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

type SmokeResult = { ok: boolean; step: string; [key: string]: unknown }

/** Proves the author can see all three body-version derivative states in one chapter card. */
export async function runChapterDerivativeStaleSmoke(
  window: BrowserWindow,
  capturePath?: string
): Promise<SmokeResult> {
  const reloaded = await new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('重新加载写作界面超时')), 15_000)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      resolve(true)
    })
    window.webContents.reload()
  }).catch(() => false)
  if (!reloaded || window.isDestroyed()) return { ok: false, step: 'renderer-reload-failed' }
  await new Promise((resolve) => setTimeout(resolve, 700))

  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (read, attempts = 120) => {
      for (let index = 0; index < attempts; index += 1) {
        const value = await read()
        if (value) return value
        await wait(80)
      }
      return null
    }
    try {
      await until(async () => {
        const status = await window.novelDesktop.projects.status().catch(() => null)
        return status?.project?.title === '烟测书稿' ? status : null
      })
      if (!document.querySelector('[aria-label="书稿"]')) {
        const workItem = await until(() => Array.from(document.querySelectorAll('.work-item-open')).find(button => button.getAttribute('aria-label')?.includes('烟测书稿')))
        workItem?.click()
      }
      const manuscriptNavigation = await until(() => document.querySelector('[aria-label="书稿"]'))
      if (!manuscriptNavigation) return { ok: false, step: 'manuscript-navigation-missing', body: document.body.textContent?.slice(0, 500) || '' }
      manuscriptNavigation.click()
      const chapter = await until(() => document.querySelector('.chapter-tree-row'))
      if (!chapter) return { ok: false, step: 'chapter-missing' }
      if (chapter instanceof HTMLButtonElement) chapter.click()
      const assistant = document.querySelector('.assistant-toggle')
      if (assistant?.getAttribute('aria-expanded') !== 'true') assistant?.click()
      const checksMode = await until(() => document.querySelector('[data-testid="assistant-mode-checks"]'))
      checksMode?.click()
      const trigger = await until(() => document.querySelector('[data-testid="open-chapter-card"]'))
      if (!trigger) return { ok: false, step: 'chapter-card-trigger-missing' }
      trigger.click()
      const status = await until(() => {
        const value = document.querySelector('[data-testid="chapter-derived-status"]')
        return value?.textContent?.includes('已过期') ? value : null
      })
      if (!status) return { ok: false, step: 'derivative-status-missing' }
      const facts = document.querySelector('[data-testid="chapter-derived-facts"]')
      const summary = document.querySelector('[data-testid="chapter-derived-summary"]')
      const checks = document.querySelector('[data-testid="chapter-derived-checks"]')
      const texts = {
        facts: facts?.textContent || '',
        summary: summary?.textContent || '',
        checks: checks?.textContent || ''
      }
      await wait(120)
      return {
        ok: Boolean(
          facts?.classList.contains('status-stale')
          && summary?.classList.contains('status-stale')
          && checks?.classList.contains('status-stale')
          && texts.facts.includes('已过期')
          && texts.summary.includes('已过期')
          && texts.checks.includes('已过期')
          && document.querySelector('[data-testid="chapter-card-sheet"]')
        ),
        step: 'three-derivatives-visible',
        texts
      }
    } catch (error) {
      return { ok: false, step: 'derivative-ui-exception', error: error?.message || String(error) }
    }
  })()`).catch((error: unknown) => ({ ok: false, step: 'derivative-ui-script-rejected', error: error instanceof Error ? error.message : String(error) }))
  if (result.ok && capturePath) await writeFile(capturePath, (await window.capturePage()).toPNG())
  return result
}
