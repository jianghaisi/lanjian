import type { BrowserWindow } from 'electron'

export function runIdeaSceneScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              try {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                document.querySelector('[aria-label="素材"]')?.click()
                for (let index = 0; index < 60 && !document.querySelector('[data-testid="new-idea"]'); index += 1) await wait(100)
                const create = document.querySelector('[data-testid="new-idea"]')
                if (!create) return { ok: false, step: 'idea-entry-missing', body: document.body.textContent.slice(0, 1200) }
                create.click()
                await wait(100)
                const title = document.querySelector('[data-testid="idea-title-input"]')
                const content = document.querySelector('[data-testid="idea-content-input"]')
                const form = document.querySelector('[data-testid="idea-editor"]')
                if (!title || !content || !form) return { ok: false, step: 'idea-editor-missing' }
                title.value = '钟楼只记得最后一句谎话'
                title.dispatchEvent(new Event('input', { bubbles: true }))
                content.value = '旧城钟楼每晚会抹去所有回声，只保留当天最后一句谎话。'
                content.dispatchEvent(new Event('input', { bubbles: true }))
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
                let idea = null
                let promote = null
                for (let index = 0; index < 80; index += 1) {
                  idea = (await window.novelDesktop.workspace.listIdeas()).find((item) => item.title === '钟楼只记得最后一句谎话')
                  promote = document.querySelector('[data-testid="promote-idea-world-rule"]')
                  if (idea && promote && !promote.disabled) break
                  await wait(100)
                }
                if (!idea || !promote || promote.disabled) return { ok: false, step: 'idea-save-missing', idea, promote: Boolean(promote), disabled: promote?.disabled }
                promote.click()
                for (let index = 0; index < 80; index += 1) {
                  idea = (await window.novelDesktop.workspace.listIdeas()).find((item) => item.id === idea.id)
                  if (idea?.promotedToId) break
                  await wait(100)
                }
                const entities = await window.novelDesktop.workspace.listStoryEntities()
                const formal = entities.find((item) => item.id === idea?.promotedToId)
                for (let index = 0; index < 40; index += 1) {
                  const renderedList = document.querySelector('[data-testid="idea-list"]')
                  const renderedEditor = document.querySelector('[data-testid="idea-editor"]')
                  if (renderedList?.textContent.includes('已提升') && renderedEditor?.textContent.includes('正式世界设定')
                    && document.querySelector('.workflow-guide b')?.textContent !== '素材') break
                  await wait(100)
                }
                const list = document.querySelector('[data-testid="idea-list"]')
                const editor = document.querySelector('[data-testid="idea-editor"]')
                const workbench = document.querySelector('.material-workbench')
                const listRect = list?.getBoundingClientRect()
                const editorRect = editor?.getBoundingClientRect()
                return {
                  ok: Boolean(idea?.promotedToType === 'world_rule' && formal?.entityType === 'world_rule'
                    && JSON.parse(formal.profileJson).statement === '旧城钟楼每晚会抹去所有回声，只保留当天最后一句谎话。'
                    && list?.textContent.includes('已提升') && editor?.textContent.includes('正式世界设定')
                    && document.querySelector('.workflow-guide b')?.textContent !== '素材'
                    && listRect && editorRect && listRect.right <= editorRect.left && editorRect.right <= innerWidth),
                  step: 'idea-promoted', idea, formal,
                  layout: { list: listRect && { left: listRect.left, right: listRect.right, width: listRect.width }, editor: editorRect && { left: editorRect.left, right: editorRect.right, width: editorRect.width }, workbenchWidth: workbench?.getBoundingClientRect().width || 0 }
                }
              } catch (error) {
                return { ok: false, step: 'exception', error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '' }
              }
            })()`)
}
