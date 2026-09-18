import type { BrowserWindow } from 'electron'

export function runAutomaticBackupSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const changeValue = (element, value) => {
                element.value = value
                element.dispatchEvent(new Event('input', { bubbles: true }))
                element.dispatchEvent(new Event('change', { bubbles: true }))
              }
              document.querySelector('[aria-label="设置"]')?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="settings-nav-project"]'); index += 1) await wait(100)
              document.querySelector('[data-testid="settings-nav-project"]')?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="auto-backup-card"]'); index += 1) await wait(100)
              let card = document.querySelector('[data-testid="auto-backup-card"]')
              let enabled = document.querySelector('[data-testid="auto-backup-enabled"]')
              let retention = document.querySelector('[data-testid="auto-backup-retention"]')
              let choose = document.querySelector('[data-testid="choose-auto-backup-directory"]')
              let save = document.querySelector('[data-testid="save-auto-backup"]')
              if (!card || !enabled || !retention || !choose || !save) return { ok: false, step: 'controls-missing', text: card?.textContent || '' }
              for (let index = 0; index < 60; index += 1) {
                choose = document.querySelector('[data-testid="choose-auto-backup-directory"]')
                save = document.querySelector('[data-testid="save-auto-backup"]')
                if (choose && save && !choose.disabled && !save.disabled) break
                await wait(100)
              }
              if (!choose || !save || choose.disabled || save.disabled) return { ok: false, step: 'controls-disabled', chooseDisabled: choose?.disabled, saveDisabled: save?.disabled, text: card.textContent || '' }
              const chooseClickTrace = { connected: choose.isConnected, width: choose.getBoundingClientRect().width, beforeText: choose.textContent || '' }
              choose.click()
              await wait(20)
              chooseClickTrace.afterText = document.querySelector('[data-testid="choose-auto-backup-directory"]')?.textContent || ''
              for (let index = 0; index < 40 && document.querySelector('[data-testid="auto-backup-card"]')?.textContent?.includes('尚未选择'); index += 1) await wait(100)
              card = document.querySelector('[data-testid="auto-backup-card"]')
              enabled = document.querySelector('[data-testid="auto-backup-enabled"]')
              retention = document.querySelector('[data-testid="auto-backup-retention"]')
              if (!card || !enabled || !retention || card.textContent?.includes('尚未选择')) return { ok: false, step: 'directory-selection-not-reflected', chooseClickTrace, text: card?.textContent || '' }
              if (!enabled.checked) {
                for (let index = 0; index < 60; index += 1) {
                  enabled = document.querySelector('[data-testid="auto-backup-enabled"]')
                  if (enabled && !enabled.disabled) {
                    enabled.click()
                    await wait(50)
                    enabled = document.querySelector('[data-testid="auto-backup-enabled"]')
                    if (enabled?.checked) break
                  } else await wait(100)
                }
                if (!enabled?.checked) return { ok: false, step: 'enable-not-reflected', disabled: enabled?.disabled }
                retention = document.querySelector('[data-testid="auto-backup-retention"]')
                if (!retention) return { ok: false, step: 'retention-missing-after-enable' }
              }
              changeValue(retention, '2')
              await wait(80)
              save = document.querySelector('[data-testid="save-auto-backup"]')
              if (!save || save.disabled) return { ok: false, step: 'save-disabled-after-selection', text: document.querySelector('[data-testid="auto-backup-card"]')?.textContent || '' }
              save.click()
              let status = null
              for (let index = 0; index < 120; index += 1) {
                status = await window.novelDesktop.projects.getAutoBackup()
                if (status.lastSuccessAt && status.lastResult?.backupPath) break
                if (status.state === 'failed') return { ok: false, step: 'automatic-backup-failed', status, text: document.querySelector('[data-testid="auto-backup-card"]')?.textContent || '' }
                await wait(100)
              }
              card = document.querySelector('[data-testid="auto-backup-card"]')
              if (!card) return { ok: false, step: 'card-missing-after-save', status }
              card.scrollIntoView({ block: 'center' })
              await wait(120)
              const visibleRect = card.getBoundingClientRect()
              return {
                ok: Boolean(status?.enabled
                  && status.retentionCount === 2
                  && status.lastSuccessAt
                  && status.lastResult?.verified
                  && status.lastResult?.backupPath
                  && !card.textContent?.includes('尚未选择')
                  && visibleRect.width >= 560),
                step: 'automatic-backup-ready',
                status,
                text: card.textContent || '',
                layout: { width: visibleRect.width, height: visibleRect.height }
              }
            } catch (error) {
              return { ok: false, step: 'automatic-backup-exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
}
