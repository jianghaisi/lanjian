import { validatePluginRecipe, type JsonValue, type PluginManifest, type PluginRecipe } from '@lanjian/writing-plugin-contracts'
import { decodeAuthorQuestionRequest, type AuthorQuestion } from '../../../contracts/assistant/author-interaction-contracts'

export type WorkflowTextEdit = { toolId: string; value: string } & (
  | { field: 'result' }
  | { stepId: string; questionId: string; field: 'prompt' | 'detail' }
  | { stepId: string; questionId: string; optionId: string; field: 'label' | 'description' }
)
export type WorkflowQuestionTarget = { toolId: string; stepId: string; questionId: string }
export type RemovedWorkflowOption = WorkflowQuestionTarget & { option: AuthorQuestion['options'][number]; index: number }
// Matches the author-question contract; draft forms never widen runtime limits.
export const workflowOptionLimit = 8
const record = (v: JsonValue | undefined): v is { [key: string]: JsonValue } => !!v && typeof v === 'object' && !Array.isArray(v)
const changed = (): never => { throw new Error('流程内容已变化或超出字段限制，请在源文件中核对后重试。') }
function readRecipe(text: string, manifest: PluginManifest): PluginRecipe {
  return validatePluginRecipe(JSON.parse(text.startsWith('\ufeff') ? text.slice(1) : text), manifest)
}
function writeRecipe(text: string, recipe: PluginRecipe): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  return (text.startsWith('\ufeff') ? '\ufeff' : '') + JSON.stringify(recipe, null, 2).replaceAll('\n', newline) + (text.endsWith('\n') ? newline : '')
}
/** Editable projection only: temporary empty required strings remain visible.
 * Dynamic templates are never flattened or replaced by this form. */
function questions(value: JsonValue | undefined): AuthorQuestion[] | null {
  try {
    if (!record(value) || 'review' in value || !Array.isArray(value.questions)) return null
    const original = value.questions
    const projected = original.map(q => {
      if (!record(q) || typeof q.prompt !== 'string' || !Array.isArray(q.options)) return changed()
      return { ...q, prompt: q.prompt.trim() ? q.prompt : '编辑中', options: q.options.map(o => {
        if (!record(o) || typeof o.label !== 'string') return changed()
        return { ...o, label: o.label.trim() ? o.label : '编辑中' }
      }) }
    })
    const validated = decodeAuthorQuestionRequest({ ...value, questions: projected }).questions
    return validated.map((q, i) => {
      const raw = original[i] as { prompt: string; options: { label: string }[] }
      if (raw.prompt.length > 1000 || raw.options.some(o => o.label.length > 120)) return changed()
      return { ...q, prompt: raw.prompt, options: q.options.map((o, j) => ({ ...o, label: raw.options[j]!.label })) }
    })
  } catch { return null }
}
function returnText(tool: PluginRecipe['tools'][number], manifest: PluginManifest) {
  const schema = manifest.tools.find(t => t.id === tool.id)?.outputSchema
  const textSchema = schema?.type === 'object' ? schema.properties.text : undefined
  return record(tool.result) && typeof tool.result.text === 'string' && textSchema?.type === 'string'
    ? { text: tool.result.text, limit: textSchema.maxLength } : null
}
export function editableDraftWorkflow(text: string, manifest: PluginManifest) {
  try {
    return readRecipe(text, manifest).tools.map(tool => ({
      id: tool.id, description: manifest.tools.find(t => t.id === tool.id)!.description,
      steps: tool.steps.filter(s => s.call === 'interaction.request').map(step => ({ id: step.id, questions: questions(step.args.question) })),
      result: returnText(tool, manifest)
    }))
  } catch { return null }
}
function literalQuestion(recipe: PluginRecipe, target: WorkflowQuestionTarget): AuthorQuestion {
  const step = recipe.tools.find(t => t.id === target.toolId)?.steps.find(s => s.id === target.stepId && s.call === 'interaction.request')
  const items = step && questions(step.args.question), question = items?.find(q => q.id === target.questionId)
  if (!step || !items || !question || !record(step.args.question)) return changed()
  // Preserve all unedited steps and the rest of this literal request.
  step.args.question = { ...step.args.question, questions: items }
  return question
}
function optionQuestion(recipe: PluginRecipe, target: WorkflowQuestionTarget): AuthorQuestion {
  const question = literalQuestion(recipe, target)
  if (question.mode === 'text') throw new Error('自由回答题不含选项，请在源文件中调整问题类型。')
  return question
}
function assertOptionRoom(question: AuthorQuestion) {
  if (question.options.length >= workflowOptionLimit) throw new Error(`每题最多 ${workflowOptionLimit} 个选项，请先移除不需要的选项。`)
}
export function addDraftWorkflowOption(text: string, manifest: PluginManifest, target: WorkflowQuestionTarget, copyId?: string): { text: string; id: string } {
  const recipe = readRecipe(text, manifest), question = optionQuestion(recipe, target)
  assertOptionRoom(question)
  const source = question.options.find(o => o.id === copyId)
  if (copyId !== undefined && !source) return changed()
  // These are author-owned recipe keys, never canonical plugin/draft identities.
  let id: string
  do { id = `option-${crypto.randomUUID()}` } while (question.options.some(o => o.id === id))
  question.options.push(source ? { ...source, id, label: `${source.label.slice(0, 116)}（副本）` } : { id, label: '' })
  return { text: writeRecipe(text, recipe), id }
}
export function removeDraftWorkflowOption(text: string, manifest: PluginManifest, target: WorkflowQuestionTarget, optionId: string): { text: string; removed: RemovedWorkflowOption } {
  const recipe = readRecipe(text, manifest), question = optionQuestion(recipe, target)
  const index = question.options.findIndex(o => o.id === optionId), option = question.options[index]
  if (!option) return changed()
  if (question.options.length <= 2) throw new Error('选择题至少保留 2 个选项。')
  question.options.splice(index, 1)
  return { text: writeRecipe(text, recipe), removed: { ...target, option: { ...option }, index } }
}
export function restoreDraftWorkflowOption(text: string, manifest: PluginManifest, removed: RemovedWorkflowOption): string {
  const recipe = readRecipe(text, manifest), question = optionQuestion(recipe, removed)
  assertOptionRoom(question)
  if (question.options.some(o => o.id === removed.option.id)) throw new Error('原选项标识已被使用，无法撤销移除。当前内容已保留。')
  if (!Number.isSafeInteger(removed.index) || removed.index < 0) return changed()
  question.options.splice(Math.min(removed.index, question.options.length), 0, { ...removed.option })
  if (!questions({ questions: [question] })) return changed()
  return writeRecipe(text, recipe)
}
export function updateDraftWorkflow(text: string, manifest: PluginManifest, edit: WorkflowTextEdit): string {
  const recipe = readRecipe(text, manifest), tool = recipe.tools.find(t => t.id === edit.toolId)
  if (!tool) return changed()
  if (edit.field === 'result') {
    const output = returnText(tool, manifest)
    if (!output || edit.value.length > output.limit || !record(tool.result)) return changed()
    tool.result.text = edit.value
  } else {
    const question = literalQuestion(recipe, edit)
    if (edit.field === 'prompt' || edit.field === 'detail') {
      if (edit.value.length > (edit.field === 'prompt' ? 1000 : 2000)) return changed()
      question[edit.field] = edit.value
    } else {
      if (!('optionId' in edit)) return changed()
      const option = question.options.find(o => o.id === edit.optionId)
      if (!option || edit.value.length > (edit.field === 'label' ? 120 : 500)) return changed()
      option[edit.field] = edit.value
    }
  }
  return writeRecipe(text, recipe)
}
