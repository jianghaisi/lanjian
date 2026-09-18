import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { BookProfile, FoundationData, ProjectSummary } from '../../../../contracts/index'
import type { WorldMapPromptSummary, WorldMapStylePreset, WorldMapView } from '../../../../contracts/world-map/world-map'

// Author-provided visual brief. Sample names are supplied by the current novel;
// readable labels and transient selection are rendered by the interactive layer.
const paperAtlasPrompt = `
请绘制一张用于小说写作平台的虚构世界地图。
画面只展示地图本体，不要绘制完整的软件界面，不要侧边栏、右侧资料面板、搜索框、筛选器、事件卡片和大量按钮。
地图采用干净的2.5D战术沙盘风格。使用略微倾斜的正交俯视角，让整块大陆像放置在桌面上的立体纸雕模型。地图可以让人联想到能够拖动和缩放，但不要制作成真实三维游戏场景。
大陆使用米白色纸张质感，海洋使用低饱和深玉绿色。陆地边缘具有2至3层轻微厚度和柔和投影。山脉、森林、河流、道路使用简洁的手绘线条与低多边形造型，不使用写实纹理。
整体配色：深墨绿色 #17211E，米白色 #F2EEE4，浅纸色 #F8F4EA，强调橙色 #FF6337，玉绿色 #448B79。
地图上不要到处放置统一的地图图钉。重要地点应当直接绘制具有辨识度的微缩标志建筑。
建筑应当像精致的微缩沙盘模型，大小明显但不过度夸张。建筑和地图使用统一的米白、灰墨色，仅保留少量玉绿色和橙色细节。
核心地点显示建筑。次要地点使用简化建筑剪影。普通地点只显示非常小的圆点或短线。不要让所有地点具有相同的视觉权重。
保持大面积留白和清晰的信息层级。
不要完整软件UI。不要人物头像。不要事件资料卡。不要独立时间轴。不要到处显示数字徽章。不要显示一直存在的橙色路线。不要写实3D地形。不要奇幻羊皮纸效果。不要Google Maps风格。不要蓝紫色霓虹。不要堆叠粒子和发光。不要让建筑遮挡地形和其他地名。
最终效果应该是一张简洁、精致、可以作为小说世界空间入口的2.5D微缩沙盘地图。
`.trim()

const clip = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)
const region = (x: number, y: number) => `${y < 34 ? '上' : y > 66 ? '下' : '中'}${x < 34 ? '左' : x > 66 ? '右' : '部'}`

export type WorldMapPromptSource = {
  summary: Pick<ProjectSummary, 'id' | 'title'>
  profile: Pick<BookProfile, 'genre' | 'subgenre' | 'coreIdea'>
  foundation: Pick<FoundationData, 'worldView'>
  view: WorldMapView
}

export function buildWorldMapPrompt(source: WorldMapPromptSource, style: WorldMapStylePreset): { prompt: string; sourceFingerprint: string; summary: WorldMapPromptSummary } {
  if (style !== 'paper-atlas') throw new AppError('FEATURE_UNAVAILABLE', '当前仅提供作者确认的纸雕沙盘提示词。', { recoverable: true })
  const locations = [...new Set([
    ...source.view.events.map(event => event.location.trim()),
    ...source.view.document.markers.map(marker => marker.location.trim())
  ].filter(Boolean))].slice(0, 40).map(location => clip(location, 100))
  const events = source.view.events.filter(event => event.location.trim()).slice(0, 40).map(event => ({
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
    '为一部长篇中文小说制作一张横向世界沙盘底图。只画环境和空间，不画界面。',
    `作品：${facts.title || '未命名作品'}；题材：${facts.genre || '未分类'}${facts.subgenre ? ` / ${facts.subgenre}` : ''}。`,
    facts.coreIdea ? `核心设想：${facts.coreIdea}` : '', facts.worldView ? `世界设定：${facts.worldView}` : '',
    `必须体现的地点：${locations.join('、')}。`,
    events.length ? `重要事件所暗示的空间用途：${events.map(item => `${item.location}（${item.time || '时间未定'}：${item.event}${item.result ? `；结果 ${item.result}` : ''}）`).join('；')}。` : '',
    placements.length ? `作者给出的画面布局提示：${placements.join('；')}。这些只是构图位置，不是真实距离。` : '',
    paperAtlasPrompt,
    '用以上本书地点替换示例地标，不注入示例地名。建筑用途和时代服从本书：现代地点使用现代建筑。图中大陆是纸雕构图载体，不据此确认小说存在新的大陆或海洋；局部校园、街区用对应局部空间表达。',
    '画面要求：16:10 或 3:2 横向完整构图，主要地点有可辨认的微缩建筑轮廓。仅在小说设定支持时绘制道路联系；不把事件顺序画成旅行路线。',
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
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(facts)).digest('hex')
  return { prompt, sourceFingerprint, summary: { locations: locations.length, events: events.length, characters: characters.size, sentCharacters: prompt.length } }
}

export function worldMapStylePrompt(): string { return paperAtlasPrompt }
