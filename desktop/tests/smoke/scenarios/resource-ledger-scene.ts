import type { BrowserWindow } from 'electron'

export function runResourceLedgerSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
            const resource = await window.novelDesktop.workspace.saveStoryEntity({ entityType: 'item', canonicalName: '烟测灵石', profileJson: '{"quality":"普通"}', status: 'approved' })
            document.querySelector('[data-activity="materials"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('.section-navigation [data-activity="story"]'); index += 1) await wait(100)
            document.querySelector('.section-navigation [data-activity="story"]')?.click()
            for (let index = 0; index < 40 && !document.querySelector('[data-testid="resource-ledger"]'); index += 1) await wait(100)
            const ledger = document.querySelector('[data-testid="resource-ledger"]')
            const resourceButton = Array.from(ledger?.querySelectorAll('.resource-balance-column button') || []).find((item) => item.textContent?.includes('烟测灵石'))
            resourceButton?.click()
            await wait(80)
            const inputs = ledger?.querySelectorAll('.resource-entry-form input') || []
            const append = ledger?.querySelector('[data-testid="append-resource-ledger"]')
            if (!ledger || inputs.length !== 3 || !append || !resourceButton) return { ok: false, step: 'resource-ledger-ui-missing' }
            const setInput = (input, value) => {
              input.value = value
              input.dispatchEvent(new Event('input', { bubbles: true }))
            }
            setInput(inputs[0], '5')
            setInput(inputs[1], '第1章获得')
            setInput(inputs[2], '打开宝箱')
            append.click()
            for (let index = 0; index < 40; index += 1) {
              const current = await window.novelDesktop.workspace.getResourceLedger(resource.id)
              const visibleLedger = document.querySelector('[data-testid="resource-ledger"]')
              const visibleAppend = visibleLedger?.querySelector('[data-testid="append-resource-ledger"]')
              if (current.balances[0]?.quantity === 5
                && visibleLedger?.querySelectorAll('.resource-ledger-history li').length === 1
                && visibleAppend && !visibleAppend.disabled) break
              await wait(100)
            }
            const refreshed = document.querySelector('[data-testid="resource-ledger"]')
            const refreshedInputs = refreshed?.querySelectorAll('.resource-entry-form input') || []
            const refreshedAppend = refreshed?.querySelector('[data-testid="append-resource-ledger"]')
            if (refreshedInputs.length !== 3 || !refreshedAppend) return { ok: false, step: 'resource-ledger-refresh-missing' }
            setInput(refreshedInputs[0], '-2')
            setInput(refreshedInputs[1], '第1章消耗')
            setInput(refreshedInputs[2], '启动阵法')
            refreshedAppend.click()
            let formal = null
            for (let index = 0; index < 80; index += 1) {
              formal = await window.novelDesktop.workspace.getResourceLedger(resource.id)
              const liveLedger = document.querySelector('[data-testid="resource-ledger"]')
              if (formal.balances[0]?.quantity === 3
                && formal.entries.length === 2
                && liveLedger?.textContent?.includes('余额由历史自动累加')
                && liveLedger.querySelectorAll('.resource-ledger-history li').length === 2) break
              await wait(100)
            }
            const visible = document.querySelector('[data-testid="resource-ledger"]')
            visible?.scrollIntoView({ block: 'start' })
            await wait(120)
            return {
              ok: Boolean(formal?.balances[0]?.quantity === 3
                && formal.entries.length === 2
                && visible?.textContent?.includes('余额由历史自动累加')
                && visible.querySelectorAll('.resource-ledger-history li').length === 2),
              step: 'resource-ledger-recorded', formal
            }
          })()`)
}
