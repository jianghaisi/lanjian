import type { BrowserWindow } from 'electron'

export function runNamedVersionScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[data-activity="desk"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                const manualSave = document.querySelector('[data-testid="save-manuscript"]')
                if (!editor || !manualSave) return { ok: false, step: 'manuscript-controls-missing' }
                editor.value += String.fromCharCode(10, 10) + '版本命名桌面验收。'
                editor.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(80)
                manualSave.click()
                for (let index = 0; index < 60; index += 1) {
                  const saved = await window.novelDesktop.chapters.get(1)
                  if (saved.content.includes('版本命名桌面验收。')) break
                  await wait(100)
                }
                for (let index = 0; index < 60 && !document.querySelector('.history-action'); index += 1) await wait(100)
                document.querySelector('.history-action')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="revision-name-current"]'); index += 1) await wait(100)
                const input = document.querySelector('[aria-label="当前版本名称"]')
                const save = document.querySelector('[data-testid="revision-name-current"] button')
                if (!input || !save) return { ok: false, step: 'naming-controls-missing' }
                input.value = '第一幕关键定稿'
                input.dispatchEvent(new Event('input', { bubbles: true }))
                await wait(80)
                save.click()
                let revisions = []
                for (let index = 0; index < 60; index += 1) {
                  revisions = await window.novelDesktop.chapters.revisions(1)
                  if (revisions.some((revision) => revision.isCurrent && revision.label === '第一幕关键定稿')) break
                  await wait(100)
                }
                let current = null
                let historical = null
                for (let index = 0; index < 30; index += 1) {
                  current = document.querySelector('[data-revision-current="true"]')
                  historical = document.querySelector('.revision-body nav button:not([data-revision-current="true"])')
                  if (current?.textContent?.includes('第一幕关键定稿') && historical) break
                  await wait(100)
                }
                historical?.click()
                let changes = 0
                let restore = null
                for (let index = 0; index < 30; index += 1) {
                  changes = document.querySelectorAll('[data-testid="revision-diff"] .revision-change-block').length
                  restore = document.querySelector('.revision-ledger footer .seal-action')
                  if (changes > 0 && restore && !restore.disabled) break
                  await wait(100)
                }
                const manuscript = await window.novelDesktop.chapters.get(1)
                const restoreWasAvailableForHistory = Boolean(restore && !restore.disabled)
                current?.click()
                let currentRestore = document.querySelector('.revision-ledger footer .seal-action')
                for (let index = 0; index < 20 && !currentRestore?.disabled; index += 1) {
                  await wait(100)
                  currentRestore = document.querySelector('.revision-ledger footer .seal-action')
                }
                return {
                  ok: Boolean(current?.textContent?.includes('第一幕关键定稿') && historical && changes > 0 && restoreWasAvailableForHistory && currentRestore?.disabled && manuscript.content && revisions.length >= 2),
                  step: 'named-version-only',
                  revisions: revisions.map((revision) => ({ label: revision.label, isCurrent: revision.isCurrent })),
                  changes,
                  restoreWasAvailableForHistory,
                  currentRestoreDisabled: Boolean(currentRestore?.disabled),
                  text: document.querySelector('.revision-ledger')?.textContent?.slice(0, 900) || ''
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
}
