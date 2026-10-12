import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { BookProfile, FoundationData, ProjectSummary } from '../../../../contracts/index'
import type { WorldMapPromptSummary, WorldMapStylePreset, WorldMapView } from '../../../../contracts/world-map/world-map'
import { creativePolicyRun, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'

// The approved visual method is loaded from the released or selected plugin asset.

const clip = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)
const region = (x: number, y: number) => `${y < 34 ? '上' : y > 66 ? '下' : '中'}${x < 34 ? '左' : x > 66 ? '右' : '部'}`

export type WorldMapPromptSource = {
  summary: Pick<ProjectSummary, 'id' | 'title'>
  profile: Pick<BookProfile, 'genre' | 'subgenre' | 'coreIdea'>
  foundation: Pick<FoundationData, 'worldView'>
  view: WorldMapView
}

export function buildWorldMapPrompt(source: WorldMapPromptSource, style: WorldMapStylePreset, methods = worldMapStylePrompt()): { prompt: string; sourceFingerprint: string; summary: WorldMapPromptSummary } {
  if (style !== 'paper-atlas') throw new AppError('FEATURE_UNAVAILABLE', '当前生成入口仅支持现有地图底图协议。', { recoverable: true })
  if (!methods.trim()) throw new AppError('FEATURE_UNAVAILABLE', '地图创作方法为空，请核对写作插件中的地图方法。', { recoverable: true })
  const locations = [...new Set([
    ...source.view.events.map(event => event.location.trim()),
    ...source.view.document.markers.map(marker => marker.location.trim())
  ].filter(Boolean))].slice(0, 40).map(location => clip(location, 100))
  const events = source.view.events.filter(event => event.location.trim()).slice(0, 40).map(event => ({
    versionId: event.versionId || null, phase: event.phase || 'legacy-unknown',
    time: clip(event.time, 80), location: clip(event.location, 100), event: clip(event.event || event.title, 220), result: clip(event.result, 120)
  }))
  if (!locations.length && !events.length) throw new AppError('FEATURE_UNAVAILABLE', '当前作品还没有可用于地图的正式地点或事件，请先在纪事中补充地点。', { recoverable: true })
  const characters = new Set(source.view.events.slice(0, 40).flatMap(event => event.characters.map(name => name.trim()).filter(Boolean)))
  const placements = source.view.document.markers.filter(marker => locations.includes(marker.location)).slice(0, 40)
    .map(marker => `${clip(marker.location, 100)}：画面${region(marker.x, marker.y)}`)
  const facts = {
    title: clip(source.summary.title, 120), genre: clip(source.profile.genre, 80), subgenre: clip(source.profile.subgenre, 80),
    coreIdea: clip(source.profile.coreIdea, 500), worldView: clip(source.foundation.worldView, 800), locations, events, placements
  }
  const assemble = () => [
    '为一部长篇中文小说制作一张横向地图底图。只画环境和空间，不画界面。',
    `作品：${facts.title || '未命名作品'}；题材：${facts.genre || '未分类'}${facts.subgenre ? ` / ${facts.subgenre}` : ''}。`,
    facts.coreIdea ? `核心设想：${facts.coreIdea}` : '', facts.worldView ? `世界设定：${facts.worldView}` : '',
    `必须体现的地点：${locations.join('、')}。`,
    events.length ? `已批准事件与计划所暗示的空间用途：${events.map(item => `${item.location}（${item.phase === 'planned' ? '后续计划，不表示已经发生' : item.phase === 'realized' ? '已实现事件' : item.phase === 'deviated' ? '已偏离原计划的事件' : '阶段未标注'}；${item.time || '时间未定'}：${item.event}${item.result ? `；结果 ${item.result}` : ''}）`).join('；')}。` : '',
    placements.length ? `作者给出的画面布局提示：${placements.join('；')}。这些只是构图位置，不是真实距离。` : '',
    methods,
    '用以上本书地点替换示例地标，不注入示例地名。建筑用途和时代服从本书：现代地点使用现代建筑。构图不能据此确认小说存在新的大陆或海洋；局部校园、街区用对应局部空间表达。',
    '画面要求：16:10 或 3:2 横向完整构图，已知地点按本次地图方法表现。仅在小说设定支持时绘制道路联系；不把事件顺序画成旅行路线。',
    '地图本体不画统一图钉、数字徽章、橙色路线、选中菱形或扫描圆环；选择反馈由软件覆盖层按需显示。地理关系未明确时克制表达，不创造新的命名地点。',
    '严格禁止：任何文字、汉字、字母、数字、Logo、水印、标题栏、按钮、面板、图例、坐标轴；不要增加新的命名地点；不要把人物剪影当成正式角色设定。'
  ].filter(Boolean).join('\n')
  // Trim whole source items, never cut off the author's visual brief/negative tail.
  let prompt = assemble()
  while (prompt.length > 12_000 && (events.length || placements.length || locations.length > 1)) {
    if (events.length) events.pop()
    else if (placements.length) placements.pop()
    else locations.pop()
    prompt = assemble()
  }
  if (prompt.length > 12_000) throw new AppError('FEATURE_UNAVAILABLE', '地图方法与必需来源超过 12,000 字符预算，请缩短地图插件方法后重试。', { recoverable: true })
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(facts)).digest('hex')
  return { prompt, sourceFingerprint, summary: { locations: locations.length, events: events.length, characters: characters.size, sentCharacters: prompt.length } }
}

export function worldMapStylePrompt(policy: CreativePolicyRun = creativePolicyRun()): string {
  return policy.resolve('world-map-style').map(source => source.text).join('\n\n')
}
