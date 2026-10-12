import { computed, ref } from 'vue'
import { activeEventRows, archivedEventRows, candidateEventRows } from '../../timeline/event-projection-view'

const supportedIds = ['unifiedEventsUnreadable', 'modelSettingsUnreadable']
const reasons = ['busy', 'recovery-required', 'invalid-data', 'unavailable']

export function createWorkspaceRecoveryActions(ports) {
  const pending = ref(null)
  const feedback = ref(null)
  const valid = request => request && ports.workspaceRequests.isCurrent(request, ports.current.value)
  const workspaceRecoveryBusy = computed(() => Boolean(valid(pending.value)))
  const workspaceRecoveryFeedback = computed(() => valid(feedback.value?.request) ? feedback.value.message : '')
  const say = (request, message) => { if (valid(request)) feedback.value = { request, message } }

  function clearModelLoadIssue() {
    ports.workspaceBootstrapIssues.value = ports.workspaceBootstrapIssues.value.filter(issue => issue.id !== 'modelSettingsUnreadable')
    ports.invalidateWorkspaceSnapshot()
  }

  async function recheckWorkspaceIssues() {
    if (!ports.current.value || workspaceRecoveryBusy.value) return
    const issueIds = ports.workspaceBootstrapIssues.value.map(issue => issue.id).filter(id => supportedIds.includes(id))
    if (!issueIds.length) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const modelBefore = JSON.stringify(ports.ai.value)
    pending.value = request
    ports.invalidateWorkspaceSnapshot()
    say(request, '正在重新检查事件和模型资料…')
    try {
      const result = await ports.desktop.workspace.recheckLoadIssues({
        workItem: { id: request.workItemId, path: request.path }, issueIds
      })
      if (!valid(request) || result.workItem.id !== request.workItemId || result.workItem.path !== request.path) return
      if (result.checkedIds.length !== issueIds.length || result.checkedIds.some(id => !issueIds.includes(id))) throw Error('检查结果不完整')
      const failed = new Set(result.issues.map(issue => issue.id))
      let preservedModels = false
      if (issueIds.includes('modelSettingsUnreadable') && !failed.has('modelSettingsUnreadable')) {
        preservedModels = ports.modelSettingsDirty.value || JSON.stringify(ports.ai.value) !== modelBefore
        // Routing drafts belong to their editor. Update availability even when
        // the author has typed since this request began, without replacing input.
        ports.ai.value = preservedModels
          ? { ...ports.ai.value, apiKeyConfigured: result.aiSettings.apiKeyConfigured, modelConfigured: result.aiSettings.modelConfigured }
          : { ...result.aiSettings, connections: result.aiSettings.connections.map(c => ({ ...c, apiKey: '', clearApiKey: false })) }
      }
      if (issueIds.includes('unifiedEventsUnreadable') && !failed.has('unifiedEventsUnreadable')) {
        ports.eventProjection.value = result.eventProjection
        ports.unifiedEvents.value = activeEventRows(result.eventProjection)
        ports.archivedUnifiedEvents.value = archivedEventRows(result.eventProjection)
        ports.unifiedEventCandidates.value = candidateEventRows(result.eventProjection)
      }
      ports.workspaceBootstrapIssues.value = [
        ...ports.workspaceBootstrapIssues.value.filter(issue => !issueIds.includes(issue.id)), ...result.issues
      ]
      ports.invalidateWorkspaceSnapshot()
      const recovered = issueIds.length - failed.size
      say(request, `${recovered ? `已恢复 ${recovered} 项。` : ''}${failed.size ? '仍有项目无法读取，请按下方说明处理。' : '检查完成，可以继续创作。'}${preservedModels ? '未保存的模型设置已保留。' : ''}`)
    } catch {
      say(request, '本次检查未完成，当前输入已保留。请稍后重新检查；持续失败时可复制下方诊断信息反馈。')
    } finally {
      if (pending.value?.generation === request.generation && pending.value?.path === request.path) pending.value = null
    }
  }

  function workspaceIssueDiagnostic(issue) {
    // Never copy arbitrary exception text, paths, provider details or author data.
    return `岚笺加载诊断\n版本：${ports.appVersion.value || '未知'}\n问题：${supportedIds.includes(issue.id) ? issue.id : 'unknown'}\n原因：${reasons.includes(issue.reason) ? issue.reason : 'unavailable'}`
  }

  async function copyWorkspaceIssueDiagnostic(issue) {
    if (!ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    try {
      const text = workspaceIssueDiagnostic(issue)
      try { await navigator.clipboard.writeText(text) }
      catch {
        // The desktop session denies browser clipboard permissions. A user-
        // initiated copy of selected diagnostic text needs no broader grant.
        const active = document.activeElement, selection = window.getSelection()
        const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
        const input = document.createElement('textarea')
        input.value = text; input.readOnly = true
        input.style.cssText = 'position:fixed;left:-9999px;top:0'
        document.body.appendChild(input)
        try { input.select(); if (!document.execCommand('copy')) throw Error('Copy unavailable') }
        finally {
          input.remove(); active?.focus?.({ preventScroll: true })
          if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)) }
        }
      }
      say(request, '已复制诊断信息，不含正文或接口密钥。')
    } catch { say(request, '无法自动复制，请展开“诊断信息”后选择文本复制。') }
  }

  return { workspaceRecoveryBusy, workspaceRecoveryFeedback, recheckWorkspaceIssues, clearModelLoadIssue,
    workspaceIssueDiagnostic, copyWorkspaceIssueDiagnostic }
}
