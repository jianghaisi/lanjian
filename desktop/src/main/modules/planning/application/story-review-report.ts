import { AppError } from '../../../core/errors/app-error'

export type StoryReviewIssue = { category: string; quote: string; parentQuote: string; reason: string; needsAuthor: boolean }
export const storyReviewCategories = ['readability', 'concrete-events', 'causality', 'expansion', 'continuity', 'repetition', 'chapter-split', 'rule-pollution', 'sentence-purpose', 'upstream-gap', 'constraint-drift', 'character-name']
const protectedWords = new Set(['其他', '吉他', '他乡'])
const normalize = (text: string) => text.replace(/\r\n/g, '\n')
export function storyTextFields(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(storyTextFields)
  return value && typeof value === 'object' ? Object.values(value).flatMap(storyTextFields) : []
}
function locate(texts: string[], quote: string): boolean {
  return texts.some(text => normalize(text).includes(normalize(quote)))
}
export function parseStoryReview(text: string, candidate: unknown, parent: string, names: string[], reviewNames = true): StoryReviewIssue[] {
  const fail = (field: string, index?: number): never => { throw new AppError('AI_RESPONSE_INVALID',
    `内容复核证据与候选或父级不符：${index === undefined ? '' : `第 ${index + 1} 项，`}${field}。可重新复核，或查看详情。`, { recoverable: true }) }
  let value: unknown
  try { value = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')) } catch { return fail('报告不是有效 JSON') }
  if (!value || typeof value !== 'object' || !('issues' in value) || !Array.isArray(value.issues) || value.issues.length > 30) return fail('缺少有效的问题列表 issues')
  const fields = storyTextFields(candidate)
  // Parent can be plain material followed by individual serialized upstream documents.
  const parents: string[] = []
  try { parents.push(...storyTextFields(JSON.parse(parent))) } catch {
    let plain: string[] = []
    for (const line of parent.split('\n')) {
      try {
        const decoded = JSON.parse(line)
        if (plain.length) { parents.push(plain.join('\n')); plain = [] }
        parents.push(...storyTextFields(decoded))
      } catch { plain.push(line) }
    }
    if (plain.length) parents.push(plain.join('\n'))
  }
  return value.issues.map((raw: unknown, i: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('问题必须是对象', i)
    const issue = raw as Record<string, unknown>
    if (typeof issue.category !== 'string' || !storyReviewCategories.includes(issue.category)) return fail('category 问题类型无效', i)
    for (const key of ['quote', 'parentQuote', 'reason']) {
      if (typeof issue[key] !== 'string' || issue[key].length > 5000 || (key === 'reason' && !issue[key].trim())) return fail(`${key} 字段缺失、类型错误或超长`, i)
    }
    if (typeof issue.needsAuthor !== 'boolean') return fail('needsAuthor 必须是 true 或 false', i)
    const q = issue.quote as string, p = issue.parentQuote as string
    if (q && !locate(fields, q)) return fail('quote 在草稿中找不到逐字原句', i)
    if (p && !locate(parents, p)) return fail('parentQuote 在本次父级或素材中找不到逐字依据', i)
    if (issue.category === 'character-name' && (!reviewNames || !q || protectedWords.has(q) || /^《[^》]+》$/.test(q) || !locate(names, q))) return fail('姓名检查的 quote 必须来自允许检查的人物或故事字段，不能引用正常词语或固定题名', i)
    return { category: issue.category, quote: q, parentQuote: p, reason: issue.reason as string, needsAuthor: issue.needsAuthor || issue.category === 'upstream-gap' }
  })
}
