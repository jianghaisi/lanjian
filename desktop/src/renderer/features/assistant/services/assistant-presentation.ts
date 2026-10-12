import MarkdownIt from 'markdown-it'

// AI text is a document, never executable HTML, remote media or app navigation.
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false })
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index]!.content)
markdown.renderer.rules.link_open = () => '<span class="assistant-document-link">'
markdown.renderer.rules.link_close = () => '</span>'
export function renderAssistantDocument(content: string): string { return markdown.render(content) }
export function assistantCharacterCount(content: string): number { return Array.from(content.replace(/\s/g, '')).length }

export type AssistantTurn = { role: 'user' | 'assistant'; content: string; tools?: string[]; runId?: string; incomplete?: boolean; answerSubmissionId?: string }
export const assistantInstructionLimit = 10000
export function appendAssistantRequest(draft: string, request: string): { value: string; error?: never } | { error: string; value?: never } {
  if (!request.trim()) return { error: '这条要求没有可填入的文字，当前草稿已保留。' }
  const present = draft === request || draft.endsWith('\n\n' + request)
  const value = present ? draft : draft ? draft + '\n\n' + request : request
  if (value.length > assistantInstructionLimit) return { error: '追加后会超过输入上限，当前草稿已保留。请先减少输入。' }
  return { value }
}
export function appendAssistantQuote(draft: string, content: string, role: AssistantTurn['role']): { value: string; error?: never } | { error: string; value?: never } {
  if (!content.trim()) return { error: '这条消息没有可引用的正文。' }
  const quote = `> ${role === 'user' ? '你此前的要求' : '智能助笔'}：\n` + content.replace(/\r\n/g, '\n').split('\n').map(line => `> ${line}`).join('\n')
  const value = (draft ? draft + '\n\n' : '') + quote + '\n\n'
  if (value.length > assistantInstructionLimit) return { error: '引用后会超过输入上限。请减少输入，或选中消息中需要的几句话再引用；当前输入已保留。' }
  return { value }
}
// Display-only IDs. They are never persisted or sent to main as task identities.
export function copilotMessages(turns: AssistantTurn[]) {
  return turns.map((turn, index) => ({ id: `display-${index}`, role: turn.role, content: turn.content }))
}
export function matchesAssistantHistory(query: string, ...values: string[]): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const text = values.join('\n').toLocaleLowerCase()
  return terms.every(term => text.includes(term))
}

export type AssistantReview = {
  message: string; page: string; history: Array<{ role: string; content: string }>
  fields: Array<{ label: string; value: string | number | boolean }>; backgrounds: string[]
}
export function readAssistantReview(text: string): AssistantReview | null {
  try {
    const value = JSON.parse(text)
    if (typeof value.message !== 'string' || typeof value.page !== 'string' ||
      !Array.isArray(value.fields) || !value.fields.every((f: any) => typeof f?.label === 'string' && ['string','number','boolean'].includes(typeof f.value)) ||
      !Array.isArray(value.backgrounds) || !value.backgrounds.every((b: unknown) => typeof b === 'string') ||
      !Array.isArray(value.history) || !value.history.every((h: any) => typeof h?.role === 'string' && typeof h.content === 'string')) return null
    return value
  } catch { return null }
}
