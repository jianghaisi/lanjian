import type { PluginManifest } from '@lanjian/writing-plugin-contracts'
import type { DraftContent } from '../../../../contracts/writing-plugins/authoring'
import { usefulWritingPluginSources } from './bundled-writing-plugins'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'

/** Release-owned content, bundled by the main build. No server, author files or
 * executable Node imports are used to discover these packages. */
export function bundledPluginSources(): DraftContent[] {
  const guidance = [
    ['xianxia', '仙侠世界构筑', ['genre', 'worldbuilding'], ['仙侠', '长篇'],
      '围绕修行代价、宗门资源与境界差异组织仙侠情节，保持力量成长有依据。',
      '以本书已确认的世界设定、动态境界表和力量规则为唯一依据。场景中检查人物现有实力、修炼资源、突破条件与能力代价；境界差距应通过可观察的能力与限制体现。让宗门的资源、规则和利益影响人物选择，不凭空替换门派或力量体系。突破先铺垫训练、事件和代价，再表现结果；不为制造爽点无依据越级。涉及系统提示时逐项套用作者定义的固定系统模板。缺失设定先作为待确认建议，不能当成已发生事实。'],
    ['mystery', '悬疑线索编排', ['genre', 'plot'], ['悬疑', '线索'],
      '区分事实、人物猜测与误导线索，让揭示能够回溯到已有证据。',
      '遵循总纲、事件时间线与本章目标。区分已确认事实、角色认知和读者当前能看到的信息，角色不能提前知道尚未取得的证据。为关键结论提供可回溯的线索与合理获取过程；误导应来自视角局限或人物行动，而非隐藏必需信息。检查时间、参与人物、地点和事件结果是否一致，追问证据为何在此刻被发现。结尾可以提出新问题，但不能凭空宣布真相、制造全知解释或跳过应有的查证。'],
    ['restrained', '克制的叙事', ['style'], ['细节', '留白'],
      '用动作、感官与具体物件承接情绪，减少重复解释，保留人物各自的声线。',
      '保持原作品的人称、时态与人物声线。用当事人能够感知的动作、物件和环境变化表达情绪，避免连续解释同一个心理结论。重要动作给足因果，过渡处简洁；情绪强烈时也不堆叠空泛形容词或替人物总结人生道理。让言语与行动之间留有可理解的余地。修订只提出候选，不擅自删去已确认事件、关键证据或作者原意。'],
    ['dialogue', '对白与人物声线', ['style', 'characters'], ['对白', '人物'],
      '从人物的目的、关系和知情范围出发，让对话各有声音并推动场景。',
      '先明确每位说话者此刻想得到什么、害怕失去什么，以及彼此关系与已知信息。根据既有人设区分措辞、句长、停顿和称呼，不让所有角色用同一种分析式语言。对白伴随必要的动作与反应，能改变场景局面；减少互相复述双方都知道的背景。潜台词应能从行动与上下文读出，不靠每句后的解释。人物不能泄露未知信息或突然改变立场而无事件支撑。'],
    ['motivation', '人物动机核对', ['characters', 'review'], ['动机', '人物弧线'],
      '核对目标、阻力、选择与后果，帮助保持人物行为和成长连贯。',
      '从本书既有人物资料与事件证据核对：眼前目标、长期需要、可用信息、现实阻力、具体选择及后果。人物的决定应能由其经历、关系或新证据解释；转变需要可追溯的压力与行动，不直接改变已确认人设。区分表面行为和动机推测，缺少证据时明确待作者判断。让配角有自身诉求，但不越过总纲与章纲扩大剧情。审校时指出对应原文或事件依据，不凭空创造缺陷。'],
    ['foreshadow', '伏笔与承诺核对', ['plot', 'review'], ['伏笔', '长篇'],
      '检查线索铺设、推进与兑现，关注读者已经看到的承诺和时间顺序。',
      '以实际提供的总纲、时间线、章纲与正文证据梳理伏笔；没有读到的内容不能视为不存在。区分已经铺设、正在推进、已经回收和仍待确认的线索，注明可核对的事件或段落。兑现应回应原先的问题并符合时间、人物和地点限制；反转仍须保留已有事实。对重复铺垫、突兀回收或遗忘承诺提出候选改法，不把建议当成正式事实，也不为了回收伏笔擅自改写上游设定。']
  ] as const
  const sources: DraftContent[] = guidance.map(([id, name, categories, tags, description, text]) => {
    const manifest: PluginManifest = { apiVersion: 1, id: `lanjian.bundled.${id}`, version: '1.0.0', name, description, runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], categoryIds: [...categories], tags: [...tags],
      contributions: [{ id: 'guidance', name, kind: 'context-fragment', stages: ['assistant', 'worldbuilding', 'planning', 'writing', 'review'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, text }] }
    return { manifestText: JSON.stringify(manifest), files: [{ path: 'main.js', content: 'export async function execute() { return {} }\n' }] }
  })
  const workflow: PluginManifest = { apiVersion: 1, id: 'lanjian.bundled.writing-focus', version: '1.0.0', name: '写前决策流程', description: '写作前先确认本轮重点与约束，让助笔根据作者的真实回答继续。', runtime: 'declarative', entry: 'recipe.json', capabilities: ['author.ask'], categoryIds: ['workflow', 'interaction'], tags: ['写前准备', '作者选择'], tools: [{ id: 'choose_focus', description: '开始写作前，请作者选择本轮重点并补充约束。得到真实回答后再继续，不代表采用正文。', effect: 'interaction', capabilities: ['author.ask'], inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 100 }, answers: { type: 'array', maxItems: 2, items: { type: 'object', properties: { id: { type: 'string', maxLength: 64 }, chosenOptionIds: { type: 'array', maxItems: 1, items: { type: 'string', maxLength: 64 } }, customText: { type: 'string', maxLength: 12000 }, skipped: { type: 'boolean' } }, required: ['id', 'chosenOptionIds', 'customText', 'skipped'], additionalProperties: false } } }, required: ['text', 'answers'], additionalProperties: false } }] }
  sources.push({ manifestText: JSON.stringify(workflow), files: [{ path: 'recipe.json', content: JSON.stringify({ format: 1, tools: [{ id: 'choose_focus', steps: [{ id: 'answer', call: 'interaction.request', args: { question: { questions: [{ id: 'focus', prompt: '这轮写作优先打磨什么？', mode: 'single', required: true, options: [{ id: 'plot', label: '情节推进' }, { id: 'character', label: '人物与对白' }, { id: 'atmosphere', label: '氛围与文风' }] }, { id: 'constraints', prompt: '有哪些必须保留或避免的内容？', mode: 'text', required: false, options: [] }] } } }], result: { text: '请依据真实回答继续：plot=情节推进，character=人物与对白，atmosphere=氛围与文风；constraints 为作者约束。', answers: { $ref: 'steps.answer.answers' } } }] }) }] })
  const counter: PluginManifest = { apiVersion: 1, id: 'lanjian.bundled.text-count', version: '1.0.0', name: '片段字数统计', description: '统计输入片段的字符数、非空白字符数与自然段数，不读取或改写作品。', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], categoryIds: ['tools', 'format'], tags: ['字数', '段落'], tools: [{ id: 'count_text', description: '统计作者提供的片段字符数、非空白字符数与非空段落数。Unicode 字符按码点计数，空行不算段落。', effect: 'derive', capabilities: [], inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 12000 } }, required: ['text'], additionalProperties: false }, outputSchema: { type: 'object', properties: { characters: { type: 'integer', minimum: 0 }, nonWhitespace: { type: 'integer', minimum: 0 }, paragraphs: { type: 'integer', minimum: 0 } }, required: ['characters', 'nonWhitespace', 'paragraphs'], additionalProperties: false } }] }
  sources.push({ manifestText: JSON.stringify(counter), files: [{ path: 'main.js', content: 'export async function execute(toolId, input) {\n  if (toolId !== "count_text") throw new Error("Unknown tool");\n  const characters = Array.from(input.text);\n  return { characters: characters.length, nonWhitespace: characters.filter(c => !/\\s/u.test(c)).length, paragraphs: input.text.split(/\\r?\\n/).filter(p => p.trim()).length };\n}\n' }] })
  const official = officialCreativePackages().map(pkg => ({ manifestText: JSON.stringify(pkg.manifest), files: [...pkg.files].filter(([path]) => path !== 'lanjian-plugin.json').map(([path, content]) => ({ path, content })) }))
  return [...sources, ...usefulWritingPluginSources(), ...official]
}
