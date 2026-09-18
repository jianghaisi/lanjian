import type { BrowserWindow } from 'electron'

export function runPromptWorkshopPassedScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            try {
            for (let index = 0; index < 40 && !document.querySelector('[aria-label="设置"]') && !document.querySelector('.work-item-open'); index += 1) await wait(100)
            if (!document.querySelector('[aria-label="设置"]')) {
              const workItem = Array.from(document.querySelectorAll('.work-item-open')).find((button) => button.getAttribute('aria-label')?.includes('烟测书稿'))
              workItem?.click()
              for (let index = 0; index < 80 && !document.querySelector('[aria-label="设置"]'); index += 1) await wait(100)
            }
            const settingsNavigation = document.querySelector('[aria-label="设置"]')
            if (!settingsNavigation) return { ok: false, step: 'settings-navigation-missing', text: document.body.textContent?.slice(0, 1200) || '' }
            settingsNavigation.click()
            for (let index = 0; index < 50 && !document.querySelector('[data-testid="settings-nav-prompts"]'); index += 1) await wait(100)
            const promptNavigation = document.querySelector('[data-testid="settings-nav-prompts"]')
            if (!promptNavigation) return { ok: false, step: 'prompt-navigation-missing' }
            promptNavigation.click()
            for (let index = 0; index < 50 && !document.querySelector('[data-testid="prompt-workshop"]'); index += 1) await wait(100)
            const workshop = document.querySelector('[data-testid="prompt-workshop"]')
            const proseTab = Array.from(workshop?.querySelectorAll('.prompt-task-tabs button') || []).find((item) => item.textContent?.includes('正文'))
            if (!workshop || !proseTab) return { ok: false, step: 'prompt-workshop-missing' }
            proseTab.click()
            await wait(100)
            const ledger = workshop.querySelector('[data-testid="prompt-context-ledger"]')
            ledger?.querySelector('summary')?.click()
            const authorityIds = Array.from(ledger?.querySelectorAll('[data-authority-id]') || []).map((item) => item.dataset.authorityId)
            if (authorityIds.join(',') !== 'guardrails,canon,taskContext,taskStrategy,materials') return { ok: false, step: 'prompt-authority-order', authorityIds }
            const editor = workshop.querySelector('textarea')
            const save = Array.from(workshop.querySelectorAll('.prompt-actions button')).find((item) => item.textContent?.includes('保存本书提示词'))
            if (!editor || !save) return { ok: false, step: 'prompt-editor-missing' }
            editor.value = '烟测正文提示词：严格兑现章纲节点，不提前消耗后续事件。'
            editor.dispatchEvent(new Event('input', { bubbles: true }))
            await wait(80)
            save.click()
            let profile = null
            let savedEntry = null
            for (let index = 0; index < 40; index += 1) {
              profile = await window.novelDesktop.workspace.getPromptProfile()
              savedEntry = profile.entries.find((entry) => entry.task === 'prose')
              if (savedEntry?.override === editor.value) break
              await wait(100)
            }
            if (savedEntry?.override !== editor.value) return { ok: false, step: 'prompt-save' }
            const customSource = savedEntry?.authorityLayers?.find((layer) => layer.id === 'taskStrategy')?.source || ''
            let customizedLedger = document.querySelector('[data-testid="prompt-context-ledger"]')
            for (let index = 0; index < 30 && !customizedLedger?.textContent?.includes('当前作品 · 作者覆写'); index += 1) {
              await wait(100)
              customizedLedger = document.querySelector('[data-testid="prompt-context-ledger"]')
            }
            if (customSource !== '当前作品 · 作者覆写' || !customizedLedger?.textContent?.includes('当前作品 · 作者覆写')) {
              return { ok: false, step: 'prompt-authority-custom-source', customSource, ledger: customizedLedger?.textContent || '' }
            }
            window.confirm = () => true
            const reset = Array.from(workshop.querySelectorAll('.prompt-actions button')).find((item) => item.textContent?.includes('恢复题材基线'))
            if (!reset || reset.disabled) return { ok: false, step: 'prompt-reset-disabled' }
            const resetStyle = getComputedStyle(reset)
            const promptSaveStyle = getComputedStyle(save)
            if (reset.getBoundingClientRect().height !== save.getBoundingClientRect().height
              || resetStyle.borderRadius !== promptSaveStyle.borderRadius
              || resetStyle.fontFamily !== promptSaveStyle.fontFamily
              || !reset.classList.contains('secondary')
              || !save.classList.contains('primary')) return { ok: false, step: 'prompt-action-visual-system' }
            reset.click()
            let resetEntry = null
            for (let index = 0; index < 40; index += 1) {
              profile = await window.novelDesktop.workspace.getPromptProfile()
              resetEntry = profile.entries.find((entry) => entry.task === 'prose')
              if (resetEntry && !resetEntry.customized) break
              await wait(100)
            }
            if (resetEntry?.customized) return { ok: false, step: 'prompt-reset' }
            const baselineSource = resetEntry?.authorityLayers?.find((layer) => layer.id === 'taskStrategy')?.source || ''
            let refreshedLedger = document.querySelector('[data-testid="prompt-context-ledger"]')
            for (let index = 0; index < 30 && !refreshedLedger?.textContent?.includes('当前题材 · 内置基线'); index += 1) {
              await wait(100)
              refreshedLedger = document.querySelector('[data-testid="prompt-context-ledger"]')
            }
            if (baselineSource !== '当前题材 · 内置基线' || !refreshedLedger?.textContent?.includes('当前题材 · 内置基线')) {
              return { ok: false, step: 'prompt-authority-baseline-source', baselineSource, ledger: refreshedLedger?.textContent || '' }
            }
            const settingsPage = document.querySelector('.settings-editor')
            if (settingsPage instanceof HTMLElement) settingsPage.scrollTop = 0
            return { ok: true }
            } catch (error) {
              return { ok: false, step: 'prompt-workshop-exception', errorName: error?.name || typeof error, errorMessage: error?.message || String(error) }
            }
          })()`)
}
