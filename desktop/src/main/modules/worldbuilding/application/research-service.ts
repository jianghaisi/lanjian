import type { ResearchResult, ResearchSource } from '../../../../contracts/index'
import { SettingsStore } from '../../../platform/settings/settings-store'

type ArkAnnotation = { type?: string; title?: string; url?: string }
type ArkContent = { type?: string; text?: string; annotations?: ArkAnnotation[] }
type ArkOutput = { type?: string; action?: { query?: string }; content?: ArkContent[] }

export class ResearchService {
  constructor(private readonly settings: Pick<SettingsStore, 'researchSettings' | 'researchApiKey'>, private readonly fetcher: typeof fetch = fetch) {}

  async search(rawQuery: string, signal?: AbortSignal): Promise<ResearchResult> {
    const query = rawQuery.trim()
    if (query.length < 2) throw new Error('请输入至少两个字的采风关键词')
    if (query.length > 500) throw new Error('采风关键词不能超过 500 字')
    const config = await this.settings.researchSettings()
    signal?.throwIfAborted()
    const response = await this.fetcher(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.settings.researchApiKey()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        input: `请使用联网搜索围绕以下小说素材关键词进行采风：${query}\n要求：尽可能覆盖不同来源与观点，合并重复信息；区分可核实事实、流行梗、争议观点和可改编事件；不得虚构搜索结果；最后给出适合小说创作的素材摘要并保留来源链接。`,
        tools: [{ type: 'web_search' }]
      }),
      signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(signal ? [signal] : [])])
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`联网搜索返回 ${response.status}，请核对采风接口配置后重试。`)
    }
    const payload = await response.json() as { model?: string; output?: ArkOutput[]; usage?: { tool_usage?: { web_search?: number } } }
    const outputs = payload.output ?? []
    const contentParts: string[] = []
    const sourceMap = new Map<string, ResearchSource>()
    for (const output of outputs) {
      for (const item of output.content ?? []) {
        if (item.type === 'output_text' && item.text) contentParts.push(item.text)
        for (const annotation of item.annotations ?? []) {
          if (annotation.url && annotation.url.length <= 4096) {
            try { const url = new URL(annotation.url); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) sourceMap.set(annotation.url, { title: (annotation.title || annotation.url).slice(0, 2000), url: annotation.url }) } catch { /* Invalid provider citation is not a source. */ }
          }
        }
      }
    }
    const searchedQueries = outputs.map((item) => item.action?.query).filter((item): item is string => Boolean(item))
    const content = contentParts.join('\n\n').trim()
    if (!content) throw new Error('联网搜索完成，但没有返回可用的文字结果')
    signal?.throwIfAborted()
    if (content.length > 100000) throw new Error('采风结果过长，请缩小关键词范围后重试。')
    return {
      query,
      content,
      sources: [...sourceMap.values()],
      searchedQueries,
      webSearchCalls: Number(payload.usage?.tool_usage?.web_search || outputs.filter((item) => item.type === 'web_search_call').length),
      model: payload.model || config.model
    }
  }
}
