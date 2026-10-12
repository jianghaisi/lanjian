import { assistantCharacterCount, type AssistantTurn } from './assistant-presentation'

export type AssistantReplyChoice = { turn: AssistantTurn; number: number; request: string | null; label: string; characters: number }
export type AssistantReplyPair = [AssistantTurn | null, AssistantTurn | null]

/** Replies and their real requests are view projections, not a second transcript. */
export function assistantReplyChoices(turns: readonly AssistantTurn[]): AssistantReplyChoice[] {
  const requests = new Map<string, string>(), replies: AssistantReplyChoice[] = []
  let latest: AssistantTurn | undefined
  for (const turn of turns) {
    if (turn.role === 'user') {
      if (!turn.answerSubmissionId) { latest = turn; if (turn.runId) requests.set(turn.runId, turn.content) }
      continue
    }
    if (turn.incomplete) continue
    const request = turn.runId ? requests.get(turn.runId) ?? (!latest?.runId ? latest?.content ?? null : null) : latest?.content ?? null
    const number = replies.length + 1, text = (request ?? turn.content).replace(/\s+/g, ' ').trim()
    const points = Array.from(text), excerpt = points.slice(0, 48).join('')
    replies.push({ turn, number, request, label: `回复 ${number} · ${excerpt}${points.length > 48 ? '…' : ''}`, characters: assistantCharacterCount(turn.content) })
  }
  return replies
}

/** Appending output must not replace either reply the author is already comparing. */
export function reconcileAssistantReplyPair(replies: readonly AssistantReplyChoice[], previous: AssistantReplyPair): AssistantReplyPair {
  if (replies.length < 2) return [null, null]
  const turns = replies.map(reply => reply.turn)
  let left = previous[0] && turns.includes(previous[0]) ? previous[0] : null
  let right = previous[1] && turns.includes(previous[1]) && previous[1] !== left ? previous[1] : null
  if (!left && !right) return [turns.at(-2)!, turns.at(-1)!]
  const newest = [...turns].reverse()
  if (!left) left = newest.find(turn => turn !== right)!
  if (!right) right = newest.find(turn => turn !== left)!
  return [left, right]
}
