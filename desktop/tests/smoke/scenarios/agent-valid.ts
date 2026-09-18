import type { BrowserWindow } from 'electron'

export function runAgentValidScenario({ window }: { window: BrowserWindow }) {
  return window.webContents.executeJavaScript(`(async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
              // Drive the rendered editor through browser editing events, never CodeMirror internals.
              window.__smokeEditorText = () => Array.from(document.querySelectorAll('[data-testid="manuscript-input"] .cm-line')).map(line => line.textContent || '').join('\\n')
              window.__smokeEditorReplace = async (text) => {
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                if (!editor) return false
                editor.focus()
                document.execCommand('selectAll')
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                const transfer = new DataTransfer()
                transfer.setData('text/plain', text)
                editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
                return true
              }
              window.__smokeEditorSelect = (from, to = from) => {
                const editor = document.querySelector('[data-testid="manuscript-input"]')
                const locate = offset => {
                  for (const line of editor.querySelectorAll('.cm-line')) {
                    const length = line.textContent.length
                    if (offset <= length) {
                      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
                      let node
                      while ((node = walker.nextNode())) {
                        if (offset <= node.textContent.length) return [node, offset]
                        offset -= node.textContent.length
                      }
                      return [line, 0]
                    }
                    offset -= length + 1
                  }
                  throw new Error('Smoke selection is outside the rendered fixture')
                }
                editor.focus()
                const start = locate(from), end = locate(to)
                window.getSelection().setBaseAndExtent(start[0], start[1], end[0], end[1])
                document.dispatchEvent(new Event('selectionchange'))
              }
              const agentMode = document.querySelector('[data-testid="assistant-mode-agent"]')
              const checksMode = document.querySelector('[data-testid="assistant-mode-checks"]')
              const agentPage = document.querySelector('[data-testid="assistant-agent-page"]')
              const checksPage = document.querySelector('[data-testid="assistant-check-page"]')
              if (!agentMode || !checksMode || !agentPage || !checksPage) return { ok: false, reason: 'assistant-regions-missing' }
              checksMode.click()
              await wait(60)
              if (getComputedStyle(checksPage).display === 'none' || getComputedStyle(agentPage).display !== 'none') return { ok: false, reason: 'assistant-check-region-not-isolated' }
              agentMode.click()
              await wait(60)
              if (getComputedStyle(agentPage).display === 'none' || getComputedStyle(checksPage).display !== 'none') return { ok: false, reason: 'assistant-agent-region-not-isolated' }
              const thread = document.querySelector('[data-testid="agent-thread"]')
              const composerDock = document.querySelector('[data-testid="agent-composer-dock"]')
              const input = document.querySelector('[data-testid="writing-agent-input"]')
              const send = document.querySelector('[data-testid="run-writing-agent"]')
              const modelSelect = document.querySelector('[data-testid="writing-agent-model"]')
              if (!thread || !composerDock || !input || !send || modelSelect?.tagName !== 'BUTTON' || modelSelect.getAttribute('aria-haspopup') !== 'dialog') return { ok: false, reason: 'agent-thread-composer-or-model-missing' }
              modelSelect.click()
              await wait(80)
              const modelChoice = document.querySelector('.model-choice-list button[data-model="gemini-smoke-model"]')
              if (!modelChoice || !modelChoice.getAttribute('data-connection-id')) return { ok: false, reason: 'agent-model-option-missing' }
              modelChoice.click()
              await wait(80)
              if (modelSelect.getAttribute('data-model') !== 'gemini-smoke-model'
                || modelSelect.getAttribute('data-connection-id') !== modelChoice.getAttribute('data-connection-id')) return { ok: false, reason: 'agent-model-route-selection-failed' }
              const openSkills = document.querySelector('[data-testid="open-agent-skills"]')
              if (!openSkills) return { ok: false, reason: 'agent-operation-entry-missing' }
              openSkills.click()
              await wait(80)
              if (!document.querySelector('[data-testid="agent-skills-view"]') || !document.querySelector('[data-testid="writing-agent-input"]')) return { ok: false, reason: 'agent-skill-menu-not-mounted-over-composer' }
              const skill = Array.from(document.querySelectorAll('.agent-skill-menu button')).find((item) => item.textContent?.includes('续写'))
              if (!skill) return { ok: false, reason: 'agent-skill-missing' }
              if (skill.getAttribute('aria-pressed') === 'true') openSkills.click()
              else skill.click()
              await wait(80)
              if (!document.querySelector('[data-testid="writing-agent-input"]') || document.querySelector('[data-testid="agent-skills-view"]')) return { ok: false, reason: 'agent-skill-selection-did-not-return-to-composer' }
              const manuscript = document.querySelector('[data-testid="manuscript-input"]')
              const manuscriptText = window.__smokeEditorText()
              if (!manuscript || !manuscriptText || manuscriptText !== (await window.novelDesktop.chapters.get(1)).content) return { ok: false, reason: 'agent-anchor-rendered-fixture-incomplete' }
              const anchorOffset = Math.max(1, Math.min(manuscriptText.length - 1, manuscriptText.indexOf('，') + 1 || 6))
              window.__anchoredContinuationTail = manuscriptText.slice(anchorOffset)
              window.__smokeEditorSelect(anchorOffset)
              await wait(100)
              await wait(80)
              if (!document.querySelector('.agent-selection-state')?.textContent?.includes('将从光标处')) return { ok: false, reason: 'agent-anchor-state-missing' }
              document.querySelector('[data-testid="open-writing-agent-context"]')?.click()
              for (let index = 0; index < 50 && !document.querySelector('[data-context-preview-id="workspace:timeline"]'); index += 1) await wait(80)
              const preflight = document.querySelector('[data-testid="writing-agent-context-preflight"]')
              const timelineContext = preflight?.querySelector('[data-context-preview-id="workspace:timeline"]')
              const removeTimeline = Array.from(timelineContext?.querySelectorAll('button') || []).find((item) => item.textContent?.includes('移除'))
              if (!preflight || !timelineContext || !removeTimeline) return { ok: false, reason: 'context-preflight-controls-missing' }
              removeTimeline.click()
              for (let index = 0; index < 40 && !document.querySelector('[data-context-preview-id="workspace:timeline"]')?.textContent?.includes('本次移除'); index += 1) await wait(50)
              const liveTemporary = document.querySelector('[data-testid="writing-agent-context-preflight"] .agent-context-temporary textarea')
              if (!liveTemporary) return { ok: false, reason: 'context-temporary-input-missing' }
              liveTemporary.value = '烟测临时依据：窗外正在下雨。'
              liveTemporary.dispatchEvent(new Event('input', { bubbles: true }))
              let liveAddTemporary = null
              for (let index = 0; index < 30; index += 1) {
                liveAddTemporary = Array.from(document.querySelectorAll('[data-testid="writing-agent-context-preflight"] .agent-context-temporary > button')).find((item) => item.textContent?.includes('加入本次'))
                if (liveAddTemporary && !liveAddTemporary.disabled) break
                await wait(50)
              }
              if (!liveAddTemporary || liveAddTemporary.disabled) return { ok: false, reason: 'context-temporary-add-disabled' }
              liveAddTemporary.click()
              let livePreflight = null
              let liveTimelineContext = null
              for (let index = 0; index < 50; index += 1) {
                livePreflight = document.querySelector('[data-testid="writing-agent-context-preflight"]')
                liveTimelineContext = livePreflight?.querySelector('[data-context-preview-id="workspace:timeline"]')
                if (livePreflight?.textContent?.includes('本次补充 1') && liveTimelineContext?.textContent?.includes('本次移除')) break
                await wait(80)
              }
              if (!livePreflight?.textContent?.includes('本次补充 1') || !liveTimelineContext?.textContent?.includes('作者本次移除')) {
                return { ok: false, reason: 'context-preflight-selection-not-visible', preflight: livePreflight?.textContent?.slice(0, 1200) || '', timeline: liveTimelineContext?.textContent || '' }
              }
              livePreflight.querySelector('[aria-label="收起本次依据"]')?.click()
              const manuscriptBeforeCandidate = window.__smokeEditorText()
              input.value = '依据章纲续写下一场，保持人物动机与实力一致。'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(120)
              if (send.disabled) return { ok: false, reason: 'agent-send-disabled:' + (document.querySelector('.toast')?.textContent || '') }
              send.click()
              let candidate = null
              for (let attempt = 0; attempt < 80; attempt += 1) {
                candidate = document.querySelector('.agent-candidate')
                if (candidate) break
                await wait(120)
              }
              const turn = document.querySelector('.agent-message-assistant[data-agent-turn-id]')
              if (!candidate || !turn) return { ok: false, reason: 'agent-candidate-missing:' + JSON.stringify({ toast: document.querySelector('.toast')?.textContent || '', input: input.value, send: send.textContent, disabled: send.disabled, turns: document.querySelectorAll('.agent-message-assistant[data-agent-turn-id]').length }) }
              const storedTasks = await window.novelDesktop.ai.listWritingAgentTasks(1)
              const storedTask = storedTasks.find((task) => task.message.includes('依据章纲续写下一场') && task.status === 'succeeded')
              if (storedTask?.turn?.candidate?.mode !== 'insertAtAnchor' || storedTask.turn.candidate.insertionAnchor?.offset !== anchorOffset) return { ok: false, reason: 'anchored-candidate-not-persisted:' + JSON.stringify(storedTask?.turn?.candidate) }
              const frozenIds = storedTask?.contextPackage?.contexts.map((context) => context.id) || []
              if (!frozenIds.some((id) => id?.startsWith('temporary:')) || !storedTask?.contextPackage?.contexts.some((context) => context.preview.includes('烟测临时依据：窗外正在下雨。'))) return { ok: false, reason: 'temporary-context-not-frozen:' + JSON.stringify(frozenIds) }
              if (frozenIds.includes('workspace:timeline')) return { ok: false, reason: 'removed-context-still-frozen' }
              if (!document.querySelector('[data-testid="writing-agent-input"]') || !document.querySelector('[data-testid="agent-composer-dock"]') || document.querySelector('[data-testid="agent-skills-view"]')) return { ok: false, reason: 'agent-result-replaced-thread-or-composer' }
              if (!document.querySelector('.agent-message-user')?.textContent?.includes('依据章纲续写下一场')) return { ok: false, reason: 'agent-user-message-missing-from-thread' }
              const trace = turn.querySelector('.agent-tool-trace')
              trace?.setAttribute('open', '')
              if (!turn.textContent?.includes('续写本章')
                || !turn.textContent?.includes('gemini-smoke-model')
                || !turn.textContent?.includes('当前正文')
                || !turn.textContent?.includes('章纲契约')
                || !turn.textContent?.includes('关联前文')
                || !turn.textContent?.includes('一致性门禁')
                || !candidate.textContent?.includes('锚点续写提案')
                || !candidate.textContent?.includes('插入 1')
                || !candidate.textContent?.includes('临江酒馆前')) return { ok: false, reason: 'agent-skill-or-tool-trace-missing' }
              if (window.__smokeEditorText() !== manuscriptBeforeCandidate) return { ok: false, reason: 'candidate-wrote-before-confirmation' }
              return { ok: true, reason: 'ready' }
            })()`)
}
