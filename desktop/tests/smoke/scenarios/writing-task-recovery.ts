import type { BrowserWindow } from 'electron'

export function runWritingTaskRecoveryScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              const input = document.querySelector('[data-testid="writing-agent-input"]')
              const send = document.querySelector('[data-testid="run-writing-agent"]')
              if (!input || !send) return { ok: false, step: 'task-controls-missing' }
              const quickDraft = document.querySelector('[data-testid="draft-current-chapter"]')
              quickDraft?.click()
              await wait(100)
              if (!quickDraft || !input.value.includes('续完本章')) return { ok: false, step: 'whole-chapter-entry-missing', value: input.value }
              document.querySelector('[data-testid="open-agent-skills"]')?.click()
              await wait(60)
              const querySkill = Array.from(document.querySelectorAll('.agent-skill-menu button')).find((item) => item.textContent?.includes('问答'))
              if (!querySkill) return { ok: false, step: 'query-skill-missing' }
              querySkill.click()
              input.value = '烟测停止这个任务：当前章节是什么？'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(100)
              if (send.disabled) return { ok: false, step: 'task-send-disabled' }
              send.click()
              for (let index = 0; index < 30 && !document.querySelector('[data-testid="pause-writing-agent-task"]'); index += 1) await wait(60)
              const pause = document.querySelector('[data-testid="pause-writing-agent-task"]')
              const cancel = document.querySelector('[data-testid="cancel-writing-agent-task"]')
              if (!pause || !cancel) return { ok: false, step: 'pause-or-cancel-action-missing' }
              let persistedBeforePause = false
              for (let index = 0; index < 80; index += 1) {
                const stream = document.querySelector('[data-testid="writing-agent-stream-preview"]')?.textContent || ''
                const context = document.querySelector('[data-testid="writing-agent-context-package"]')?.textContent || ''
                const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
                persistedBeforePause = tasks.some((task) => ['running', 'streaming'].includes(task.status) && task.partial?.content?.includes('停止前已经生成'))
                if ((stream.includes('停止前已经生成') || persistedBeforePause) && context.includes('本次上下文已冻结')) break
                await wait(60)
              }
              const streamPreview = document.querySelector('[data-testid="writing-agent-stream-preview"]')
              const contextPackage = document.querySelector('[data-testid="writing-agent-context-package"]')
              if (!contextPackage?.textContent?.includes('本次上下文已冻结') || !persistedBeforePause) {
                return { ok: false, step: 'stream-or-context-preview-missing', stream: streamPreview?.textContent || '', context: contextPackage?.textContent || '', persistedBeforePause }
              }
              pause.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-testid="writing-agent-task-paused"]'); index += 1) await wait(60)
              const paused = document.querySelector('[data-testid="writing-agent-task-paused"]')
              const resume = paused?.querySelector('[data-testid^="resume-writing-agent-task-"]')
              if (!resume) return { ok: false, step: 'paused-task-not-resumable', text: paused?.textContent || '' }
              resume.click()
              for (let index = 0; index < 80; index += 1) {
                const tasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
                const child = tasks.find((task) => task.parentTaskRunId && task.attempt === 2 && task.status === 'succeeded')
                if (child?.turn?.answer) {
                  for (let settle = 0; settle < 30 && (document.querySelector('[data-testid="cancel-writing-agent-task"]') || document.querySelector('.agent-message-running')); settle += 1) await wait(60)
                  const uiSettled = !document.querySelector('[data-testid="cancel-writing-agent-task"]') && !document.querySelector('.agent-message-running')
                  return {
                    ok: tasks.some((task) => task.status === 'paused' && task.partial?.content?.includes('停止前已经生成') && task.contextPackage?.contextCount) && child.artifact?.status === 'complete' && uiSettled,
                    step: 'recovered',
                    uiSettled,
                    statuses: tasks.map((task) => ({ status: task.status, attempt: task.attempt, parent: Boolean(task.parentTaskRunId), artifact: task.artifact?.status }))
                  }
                }
                await wait(100)
              }
              return { ok: false, step: 'resume-did-not-complete', toast: document.querySelector('.toast')?.textContent || '' }
            })()`)
}
