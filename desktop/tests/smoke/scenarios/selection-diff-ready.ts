import type { BrowserWindow } from 'electron'

export function runSelectionDiffReadyScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              document.querySelector('[data-testid="assistant-mode-agent"]')?.click()
              await wait(80)
              const editor = document.querySelector('[data-testid="manuscript-input"]')
              const input = document.querySelector('[data-testid="writing-agent-input"]')
              if (!editor || !input) return { ok: false, step: 'diff-controls-missing' }
              const editorText = window.__smokeEditorText()
              if (editorText !== (await window.novelDesktop.chapters.get(1)).content) return { ok: false, step: 'diff-rendered-fixture-incomplete' }
              const end = Math.max(1, editorText.indexOf('。') + 1)
              window.__selectionDiffBefore = editorText
              window.__selectionDiffTail = editorText.slice(end)
              window.__smokeEditorSelect(0, end)
              await wait(100)
              document.querySelector('[data-testid="open-agent-skills"]')?.click()
              await wait(60)
              const rewrite = Array.from(document.querySelectorAll('.agent-skill-menu button')).find((item) => item.textContent?.includes('改写'))
              if (!rewrite) return { ok: false, step: 'rewrite-skill-missing' }
              if (rewrite.getAttribute('aria-pressed') !== 'true') rewrite.click()
              for (let index = 0; index < 20 && !document.querySelector('.agent-mounted-skill')?.textContent?.includes('改写'); index += 1) await wait(50)
              const selectionState = document.querySelector('.agent-selection-state')
              if (!document.querySelector('.agent-mounted-skill')?.textContent?.includes('改写') || !selectionState?.classList.contains('ready')) {
                return { ok: false, step: 'rewrite-skill-not-mounted', mounted: document.querySelector('.agent-mounted-skill')?.textContent || '', selection: selectionState?.textContent || '' }
              }
              input.value = '把选中的句子改得更克制。'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(120)
              const send = document.querySelector('[data-testid="run-writing-agent"]')
              if (!send || send.disabled) return { ok: false, step: 'rewrite-send-disabled', toast: document.querySelector('.toast')?.textContent || '' }
              send.click()
              let rewriteTask = null
              for (let index = 0; index < 100; index += 1) {
                const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
                rewriteTask = tasks.find((task) => task.message === '把选中的句子改得更克制。') || null
                if (rewriteTask && !['queued', 'preparing', 'running', 'streaming'].includes(rewriteTask.status)) break
                await wait(100)
              }
              if (rewriteTask?.status !== 'succeeded' || rewriteTask.skill !== 'rewrite' || !rewriteTask.turn?.candidate?.diff?.length) {
                return { ok: false, step: 'rewrite-task-result', task: rewriteTask, toast: document.querySelector('.toast')?.textContent || '' }
              }
              for (let index = 0; index < 40 && !document.querySelector('[data-agent-turn-id="' + rewriteTask.turn.id + '"] .agent-diff-block'); index += 1) await wait(50)
              const turn = document.querySelector('[data-agent-turn-id="' + rewriteTask.turn.id + '"]')
              const block = turn?.querySelector('.agent-diff-block')
              const apply = turn?.querySelector('[data-testid^="apply-agent-candidate-"]')
              if (!block?.textContent?.includes('保留原文') || !block.textContent.includes('接受修改') || !apply || apply.disabled || !apply.textContent.includes('核对第 1 处')) {
                return { ok: false, step: 'diff-pending-state', text: block?.textContent || '', applyDisabled: apply?.disabled, toast: document.querySelector('.toast')?.textContent || '', candidate: turn?.querySelector('.agent-candidate')?.textContent || '', turns: document.querySelectorAll('.agent-message-assistant[data-agent-turn-id]').length }
              }
              turn.querySelector('[data-testid="agent-diff-bulk"] > summary')?.click()
              const rejectAll = turn.querySelector('[data-testid^="reject-all-agent-diff-"]')
              const acceptAll = turn.querySelector('[data-testid^="accept-all-agent-diff-"]')
              if (!rejectAll || !acceptAll) return { ok: false, step: 'diff-bulk-actions-missing' }
              rejectAll.click()
              await wait(80)
              const keepAllApply = turn.querySelector('[data-testid^="apply-agent-candidate-"]')
              if (!rejectAll.classList.contains('active') || keepAllApply?.disabled || !keepAllApply?.textContent?.includes('正文不变')) {
                return { ok: false, step: 'diff-reject-all-state', applyText: keepAllApply?.textContent || '', rejected: rejectAll.classList.contains('active') }
              }
              acceptAll.click()
              await wait(80)
              const readyApply = turn.querySelector('[data-testid^="apply-agent-candidate-"]')
              return { ok: Boolean(acceptAll.classList.contains('active') && readyApply && !readyApply.disabled && readyApply.textContent?.includes('写入正文并保存')), step: 'diff-ready', text: block.textContent }
            })()`)
}
