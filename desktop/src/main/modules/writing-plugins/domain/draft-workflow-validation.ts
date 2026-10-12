import type { JsonValue, PluginRecipe } from '@lanjian/writing-plugin-contracts'
import { decodeAuthorQuestionRequest } from '../../../../contracts/assistant/author-interaction-contracts'
import { AppError } from '../../../../contracts/core/app-error'

// Recipe validation already bounds depth and admits only these two expressions.
// Do not evaluate author input, generate text, or invent placeholder values here.
function dynamic(value: JsonValue): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(dynamic)
  return '$ref' in value || '$join' in value || Object.values(value).some(dynamic)
}

/** Authoring preflight on an already structurally validated recipe. Saving an
 * unfinished draft remains allowed; resolved runtime questions are still checked. */
export function validateDraftWorkflowQuestions(recipe: PluginRecipe, contributionIndex?: number): void {
  for (const [toolIndex, tool] of recipe.tools.entries()) {
    let group = 0
    for (const step of tool.steps) {
      if (step.call !== 'interaction.request') continue
      group++
      const question = step.args.question!
      const reservedReview = question && typeof question === 'object' && !Array.isArray(question) && 'review' in question
      try {
        if (reservedReview) throw new Error('Reserved host review')
        if (!dynamic(question)) decodeAuthorQuestionRequest(question)
      } catch (cause) {
        const hint = reservedReview ? '普通插件不能提供系统操作核对内容，请移除提问中的 review 字段。' : '请补全问题和选项文字，并检查问题类型、数量及标识。'
        const location = contributionIndex === undefined ? '' : `第 ${contributionIndex + 1} 项贡献的`
        throw new AppError('VALIDATION_ERROR', `${location}第 ${toolIndex + 1} 个工具的第 ${group} 组提问未完成或格式无效。${hint}草稿仍可保存。`, { recoverable: true, cause })
      }
    }
  }
}
