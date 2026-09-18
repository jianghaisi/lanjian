import type { BrowserWindow } from 'electron'

export function runFocusedChapterCardSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
            try {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const setValue = (element, value) => {
                element.value = value
                element.dispatchEvent(new Event('input', { bubbles: true }))
              }
              const writingDestination = document.querySelector('[data-activity="desk"]')
              if (!writingDestination) return { ok: false, step: 'writing-destination-missing' }
              writingDestination.click()
              for (let index = 0; index < 60 && !document.querySelector('.studio[data-page="desk"]'); index += 1) await wait(100)
              if (!document.querySelector('.studio[data-page="desk"]')) return { ok: false, step: 'writing-destination-timeout' }
              for (let index = 0; index < 60 && !document.querySelector('.chapter-tree-row[type="button"]'); index += 1) await wait(100)
              document.querySelector('.chapter-tree-row[type="button"]')?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="open-chapter-card"]'); index += 1) await wait(100)
              document.querySelector('[data-testid="open-chapter-card"]')?.click()
              for (let index = 0; index < 60 && !document.querySelector('[data-testid="chapter-card-sheet"]'); index += 1) await wait(100)
              const sheet = document.querySelector('[data-testid="chapter-card-sheet"]')
              const textareas = sheet?.querySelectorAll('.chapter-card-form textarea') || []
              const inputs = sheet?.querySelectorAll('.chapter-card-form input:not([type="checkbox"])') || []
              if (!sheet || textareas.length < 6 || inputs.length < 3) return { ok: false, step: 'chapter-card-layout', textareaCount: textareas.length, inputCount: inputs.length, html: sheet?.outerHTML?.slice(0, 1200) || '' }
              setValue(textareas[0], '追查雨夜来信的真实来源。')
              setValue(textareas[1], '沈砚独自在城门外，尚未确认来信人。')
              setValue(textareas[2], '沈砚得到旧邮局地址，决定次日动身。')
              setValue(textareas[3], ['发现信封上的旧邮戳', '询问守门人', '锁定旧邮局'].join(String.fromCharCode(10)))
              setValue(textareas[4], '线索时效与城门关闭形成冲突。')
              setValue(textareas[5], '信封背面浮出不存在的日期。')
              setValue(inputs[0], '沈砚、守门人')
              setValue(inputs[1], '第三人称限知，跟随沈砚')
              setValue(inputs[2], '近距离')
              const saveCard = sheet.querySelector('[data-testid="save-chapter-card"]')
              if (!saveCard) return { ok: false, step: 'chapter-card-save-missing', html: sheet.outerHTML.slice(0, 1200) }
              saveCard.click()
              await wait(500)
              const immediatePlanning = await window.novelDesktop.chapters.getPlanning(2)
              if (immediatePlanning?.card?.goal !== '追查雨夜来信的真实来源。') return {
                ok: false, step: 'chapter-card-save-not-applied', planning: immediatePlanning,
                toast: document.querySelector('.toast')?.textContent || '', disabled: saveCard.disabled,
                values: Array.from(sheet.querySelectorAll('textarea, input')).map((item) => item.value)
              }
              let lastPlanning = null
              for (let index = 0; index < 60; index += 1) {
                const planning = await window.novelDesktop.chapters.getPlanning(2)
                lastPlanning = planning
                if (planning?.card?.goal === '追查雨夜来信的真实来源。') {
                  const rect = sheet.getBoundingClientRect()
                  return {
                    ok: planning.card.beats.length === 3
                      && planning.card.characters.length === 2
                      && planning.card.pointOfView.includes('沈砚')
                      && rect.width >= 700,
                    step: 'chapter-card-save', planning,
                    layout: { left: rect.left, right: rect.right, width: rect.width }
                  }
                }
                await wait(100)
              }
              return { ok: false, step: 'chapter-card-save-timeout', planning: lastPlanning, toast: document.querySelector('.toast')?.textContent || '', selectedChapter: document.querySelector('.chapter-tree-editor')?.textContent || '' }
            } catch (error) {
              return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
            }
          })()`)
}
