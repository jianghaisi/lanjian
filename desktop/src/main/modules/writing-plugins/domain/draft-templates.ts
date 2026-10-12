import type { DraftContent, DraftTemplate } from '../../../../contracts/writing-plugins/authoring'
import type { PluginManifest } from '@lanjian/writing-plugin-contracts'

export function pluginDraftTemplate(id: string, template: DraftTemplate): DraftContent {
  const base: PluginManifest = { apiVersion: 1, id, version: '1.0.0', name: '我的写作插件', description: '为自己的小说定制写作方法。', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], categoryIds: [template === 'code' ? 'tools' : template === 'workflow' ? 'workflow' : 'style'], tags: [] }
  let content: string
  if (template === 'context') {
    base.contributions = [{ id: 'voice', name: '叙述风格', kind: 'context-fragment', stages: ['assistant', 'planning', 'writing', 'review'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, text: '以人物可感知的细节推动场景，保持既有人物声线。' }]
    content = 'export async function execute() { return {} }\n'
  } else if (template === 'workflow') {
    base.runtime = 'declarative'; base.entry = 'recipe.json'; base.capabilities = ['author.ask']
    base.tools = [{ id: 'choose_focus', description: '请作者选择本次写作重点。', effect: 'interaction', capabilities: ['author.ask'], inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: {
      type: 'object', properties: {
        text: { type: 'string', maxLength: 100 },
        answers: { type: 'array', maxItems: 1, items: { type: 'object', properties: {
          id: { type: 'string', maxLength: 64 }, chosenOptionIds: { type: 'array', maxItems: 1, items: { type: 'string', maxLength: 64 } },
          customText: { type: 'string', maxLength: 12000 }, skipped: { type: 'boolean' }
        }, required: ['id', 'chosenOptionIds', 'customText', 'skipped'], additionalProperties: false } }
      }, required: ['text', 'answers'], additionalProperties: false
    } }]
    content = JSON.stringify({ format: 1, tools: [{ id: 'choose_focus', steps: [{ id: 'answer', call: 'interaction.request', args: { question: { questions: [{ id: 'focus', prompt: '这次先打磨哪一部分？', mode: 'single', required: true, options: [{ id: 'character', label: '人物' }, { id: 'plot', label: '情节' }] }] } } }], result: { text: '作者已回答写作重点；character 表示人物，plot 表示情节，请结合自由回答继续。', answers: { $ref: 'steps.answer.answers' } } }] }, null, 2)
  } else {
    base.tools = [{ id: 'count_text', description: '统计输入文字的字符数，不读取或改写作品。', effect: 'derive', capabilities: [], inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 12000 } }, required: ['text'], additionalProperties: false }, outputSchema: { type: 'object', properties: { characters: { type: 'integer', minimum: 0 } }, required: ['characters'], additionalProperties: false } }]
    content = 'export async function execute(toolId, input, sdk) {\n  if (toolId !== "count_text") throw new Error("Unknown tool");\n  return { characters: Array.from(input.text).length };\n}\n'
  }
  return { manifestText: JSON.stringify(base, null, 2), files: [{ path: base.entry, content }] }
}
