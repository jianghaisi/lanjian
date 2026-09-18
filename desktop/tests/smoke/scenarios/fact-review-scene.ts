import type { BrowserWindow } from 'electron'

export function runFactReviewSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-activity="desk"]')?.click()
              for (let attempt = 0; attempt < 30 && !document.querySelector('[data-testid="manuscript-input"]'); attempt += 1) await wait(100)
              const otherChapter = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('待删旧章'))
              otherChapter?.click()
              for (let attempt = 0; attempt < 30 && !document.querySelector('.tree-item.selected')?.textContent?.includes('待删旧章'); attempt += 1) await wait(100)
              const firstChapter = Array.from(document.querySelectorAll('.tree-item')).find((item) => item.textContent?.includes('雨夜追迹'))
              firstChapter?.click()
              for (let attempt = 0; attempt < 30 && !document.querySelector('.tree-item.selected')?.textContent?.includes('雨夜追迹'); attempt += 1) await wait(100)
              if (!document.querySelector('.assistant-panel')) {
                document.querySelector('[aria-controls="assistant-drawer"]')?.click()
                for (let attempt = 0; attempt < 30 && !document.querySelector('.assistant-panel'); attempt += 1) await wait(100)
              }
              document.querySelector('[data-testid="assistant-mode-checks"]')?.click()
              for (let attempt = 0; attempt < 40 && !document.querySelector('[data-testid="fact-review-panel"]'); attempt += 1) await wait(100)
              const panel = document.querySelector('[data-testid="fact-review-panel"]')
              const changes = panel?.querySelectorAll('[data-testid="fact-review-change"]') || []
              const filterNotice = panel?.querySelector('[data-testid="fact-review-filter-notice"]')
              if (!panel || changes.length !== 1 || !filterNotice?.textContent?.includes('收起 1 条')) return {
                ok: false,
                step: 'fact-review-missing',
                count: changes.length,
                filterNotice: filterNotice?.textContent || '',
                batches: await window.novelDesktop.workspace.listFactBatches(1),
                storage: await window.novelDesktop.projects.sqliteStorageStatus(),
                assistant: document.querySelector('.assistant-panel')?.textContent || ''
              }
              panel.querySelector('[data-testid="fact-review-bulk"] > summary')?.click()
              const bulk = panel.querySelector('[data-testid="fact-review-defer-all"]')
              if (!bulk) return { ok: false, step: 'fact-review-bulk-missing' }
              bulk.click()
              const locationChange = Array.from(changes).find((change) => change.textContent?.includes('所在地'))
              if (!locationChange) return { ok: false, step: 'fact-review-location-missing' }
              locationChange.querySelector('.fact-review-more > summary')?.click()
              locationChange.querySelector('[data-testid="fact-review-edit"]')?.click()
              await wait(50)
              const editInput = locationChange.querySelector('[data-testid="fact-review-edit-input"]')
              const saveEdit = locationChange.querySelector('[data-testid="fact-review-save-edit"]')
              if (!editInput || !saveEdit) return { ok: false, step: 'fact-review-edit-missing' }
              const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
              valueSetter?.call(editInput, '临江酒馆后门')
              editInput.dispatchEvent(new Event('input', { bubbles: true }))
              saveEdit.click()
              await wait(100)
              const submit = panel.querySelector('[data-testid="fact-review-submit"]')
              if (!submit || submit.disabled) return { ok: false, step: 'fact-review-submit-disabled' }
              submit.click()
              let batches = []
              for (let attempt = 0; attempt < 40; attempt += 1) {
                batches = await window.novelDesktop.workspace.listFactBatches(1)
                if (batches.some((batch) => batch.status === 'PARTIALLY_APPROVED')) break
                await wait(100)
              }
              const approved = await window.novelDesktop.workspace.approvedFactsBefore(2)
              const nextPack = await window.novelDesktop.workspace.getContextFactPack(2)
              const decidedBatch = batches.find((batch) => batch.status === 'PARTIALLY_APPROVED')
              const editedChange = decidedBatch?.changes.find((change) => change.predicate === 'location')
              document.querySelector('.assistant-panel')?.scrollTo({ top: 0 })
              await wait(100)
              return {
                ok: batches.some((batch) => batch.status === 'PARTIALLY_APPROVED')
                  && approved.length === 1
                  && JSON.parse(approved[0].objectJson) === '临江酒馆后门'
                  && JSON.parse(editedChange?.objectJson || 'null') === '临江酒馆前'
                  && JSON.parse(editedChange?.editedObjectJson || 'null') === '临江酒馆后门'
                  && nextPack.structured.approvedFacts.length === 1,
                step: 'fact-review-edited-partial',
                statuses: batches.map((batch) => batch.status),
                approved: approved.map((fact) => fact.objectJson),
                editedObjectJson: editedChange?.editedObjectJson,
                contextApproved: nextPack.structured.approvedFacts.length
              }
            })()`)
}
