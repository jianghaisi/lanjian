import type { BrowserWindow } from 'electron'

export function runContextPreflightSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-activity="settings"]')?.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-testid="settings-nav-context"]'); index += 1) await wait(100)
              document.querySelector('[data-testid="settings-nav-context"]')?.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-testid="always-confirm-ai-context"]'); index += 1) await wait(100)
              const confirmPreference = document.querySelector('[data-testid="always-confirm-ai-context"]')
              if (!confirmPreference) return { ok: false, step: 'confirmation-setting-missing' }
              if (!confirmPreference.checked) confirmPreference.click()
              document.querySelector('[data-testid="settings-page-context-budget"] .save-action')?.click()
              for (let index = 0; index < 40; index += 1) {
                const saved = await window.novelDesktop.workspace.getContextBudgetPreferences()
                if (saved.alwaysConfirmBeforeSend) break
                await wait(100)
              }
              if (!(await window.novelDesktop.workspace.getContextBudgetPreferences()).alwaysConfirmBeforeSend) return { ok: false, step: 'confirmation-setting-not-persisted' }
              document.querySelector('[data-activity="desk"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-testid="manuscript-input"]'); index += 1) await wait(100)
              const firstChapter = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('雨夜追迹'))
              if (!firstChapter) return { ok: false, step: 'chapter-missing' }
              firstChapter.click()
              await wait(120)
              if (!document.querySelector('.assistant-panel')) document.querySelector('[aria-controls="assistant-drawer"]')?.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="assistant-mode-agent"]'); index += 1) await wait(100)
              document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
              await wait(80)
               document.querySelector('[data-testid="open-agent-skills"]')?.click()
               await wait(60)
               const query = Array.from(document.querySelectorAll('.agent-skill-menu button')).find((item) => item.textContent?.includes('问答'))
               query?.click()
               const settings = await window.novelDesktop.ai.getSettings()
               await window.novelDesktop.ai.updateSettings({
                 baseUrl: ${JSON.stringify(process.env.LANJIAN_SMOKE_MODEL_URL || '')},
                 apiKey: 'context-preflight-smoke-key',
                 routingMode: 'shared',
                 shared: { ...settings.shared, model: 'gemini-smoke-model' }
               })
               document.querySelector('[data-testid="open-writing-agent-context"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-context-preview-id="workspace:timeline"]'); index += 1) await wait(100)
              let panel = document.querySelector('[data-testid="writing-agent-context-preflight"]')
              let timeline = panel?.querySelector('[data-context-preview-id="workspace:timeline"]')
              const remove = Array.from(timeline?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('移除'))
              const temporary = panel?.querySelector('.agent-context-temporary textarea')
              if (!query || !panel || !timeline || !remove || !temporary) return { ok: false, step: 'controls', text: panel?.textContent || '' }
              remove.click()
              temporary.value = '烟测临时依据：窗外正在下雨。'
              temporary.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(60)
              panel.querySelector('.agent-context-temporary > button')?.click()
              for (let index = 0; index < 50; index += 1) {
                panel = document.querySelector('[data-testid="writing-agent-context-preflight"]')
                timeline = panel?.querySelector('[data-context-preview-id="workspace:timeline"]')
                if (panel?.textContent?.includes('本次补充 1') && timeline?.textContent?.includes('本次移除')) break
                await wait(100)
              }
               if (!panel?.textContent?.includes('本次补充 1') || !timeline?.textContent?.includes('作者本次移除')) return { ok: false, step: 'selection', text: panel?.textContent || '' }
               panel.querySelector('[aria-label="收起本次依据"]')?.click()
               const input = document.querySelector('[data-testid="writing-agent-input"]')
              input.value = '烟测本次上下文预检：当前章依据是什么？'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              let send = document.querySelector('[data-testid="run-writing-agent"]')
              for (let index = 0; index < 50 && (!send || send.disabled); index += 1) {
                await wait(100)
                send = document.querySelector('[data-testid="run-writing-agent"]')
              }
              if (!send || send.disabled) return { ok: false, step: 'send-disabled', toast: document.querySelector('.toast')?.textContent || '', input: input.value, disabledNote: document.querySelector('.agent-disabled-note')?.textContent || '' }
              send.click()
              let confirmSend = null
              for (let index = 0; index < 60; index += 1) {
                confirmSend = document.querySelector('[data-testid="confirm-writing-agent-send"]')
                if (confirmSend?.textContent?.includes('确认并发送') && !confirmSend.disabled) break
                await wait(100)
              }
              const tasksBeforeConfirmation = await window.novelDesktop.ai.listWritingAgentTasks(1)
              if (tasksBeforeConfirmation.some((item) => item.message.includes('烟测本次上下文预检'))) {
                return { ok: false, step: 'task-started-before-confirmation', tasks: tasksBeforeConfirmation }
              }
              if (!confirmSend || confirmSend.disabled || !confirmSend.textContent?.includes('确认并发送')) {
                return { ok: false, step: 'confirmation-not-ready', text: document.querySelector('[data-testid="writing-agent-context-preflight"]')?.textContent || '' }
              }
              confirmSend.click()
              let task = null
              for (let index = 0; index < 100; index += 1) {
                task = (await window.novelDesktop.ai.listWritingAgentTasks(1)).find((item) => item.message.includes('烟测本次上下文预检')) || null
                if (task?.status === 'succeeded' || task?.status === 'failed') break
                await wait(100)
              }
              const frozen = task?.contextPackage?.contexts || []
              if (task?.status !== 'succeeded') return { ok: false, step: 'task', task, toast: document.querySelector('.toast')?.textContent || '', chapterTitle: document.querySelector('.chapter-title-input')?.value || '' }
              if (frozen.some((item) => item.id === 'workspace:timeline')) return { ok: false, step: 'excluded-frozen', frozen }
               if (!frozen.some((item) => item.id?.startsWith('temporary:') && item.preview.includes('烟测临时依据：窗外正在下雨。'))) return { ok: false, step: 'temporary-missing', frozen }
               document.querySelector('[data-testid="open-writing-agent-context"]')?.click()
               for (let index = 0; index < 30 && !document.querySelector('[data-testid="writing-agent-context-preflight"]'); index += 1) await wait(80)
               const reopenedTimeline = document.querySelector('[data-context-preview-id="workspace:timeline"]')
               reopenedTimeline?.scrollIntoView({ block: 'center' })
               await wait(80)
               if (!reopenedTimeline?.textContent?.includes('作者本次移除')) return { ok: false, step: 'omission-reason-not-visible', text: reopenedTimeline?.textContent || '' }
               return { ok: true, step: 'frozen', contextCount: task.contextPackage.contextCount, frozenIds: frozen.map((item) => item.id) }
            })()`)
}
