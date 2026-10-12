import type { AssistantTurn } from './assistant-presentation'

/** Mirrors the existing IPC history budget. Never silently discard the end of a long answer. */
export function assistantContext(turns: AssistantTurn[]) {
  const eligible = turns.filter(turn => !turn.incomplete)
  let excerpted = 0
  const history = eligible.slice(-12).map(turn => {
    let content = turn.content
    if (content.length > 12000) {
      const notice = `\n\n[本条历史消息过长，仅带入首尾摘录；原文 ${content.length} 字符，全文仍保留在对话中]\n\n`
      const head = Math.floor((12000 - notice.length) / 2)
      content = content.slice(0, head) + notice + content.slice(-(12000 - notice.length - head))
    }
    return { role: turn.role, content }
  })
  while (JSON.stringify(history).length > 60000) history.shift()
  for (const turn of history) if (turn.content.includes('[本条历史消息过长，仅带入首尾摘录；')) excerpted++
  return { history, included: history.length, omitted: turns.length - history.length, excerpted }
}
