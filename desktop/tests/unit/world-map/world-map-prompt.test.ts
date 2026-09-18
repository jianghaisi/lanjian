import assert from 'node:assert/strict'
import test from 'node:test'
import type { BookProfile, FoundationData, ProjectSummary } from '../../../src/contracts/index'
import type { WorldMapView } from '../../../src/contracts/world-map/world-map'
import { buildWorldMapPrompt } from '../../../src/main/modules/world-map/application/world-map-prompt'
import { decodeWorldMapDocument, decodeWorldMapImageGenerateInput, worldMapStylePresets } from '../../../src/contracts/world-map/world-map'

const source = {
  summary: { id: 'novel-one', title: '雾港来客' } as Pick<ProjectSummary, 'id' | 'title'>,
  profile: { genre: '都市异能', subgenre: '校园悬疑', coreIdea: '少女们隐藏非人的身份，主角沿着失踪案接近真相。' } as Pick<BookProfile, 'genre' | 'subgenre' | 'coreIdea'>,
  foundation: { worldView: '近未来海港城市，校园下方连接废弃研究设施，旧城区仍保留战前轨道。' } as Pick<FoundationData, 'worldView'>,
  view: {
    workItemId: 'novel-one', revision: 'a'.repeat(64), mirrorStatus: null,
    document: { version: 1, markers: [{ location: '旧校舍', x: 25, y: 72 }] }, chapters: [],
    events: [
      { id: 'direct:first', source: 'direct', sourceId: 'first', title: '停电', time: '周五深夜', characters: ['林澈', '夏弥'], location: '旧校舍', event: '两人追踪异常电流进入地下层。', result: '发现封闭的研究站入口。', chapterId: null },
      { id: 'direct:second', source: 'direct', sourceId: 'second', title: '追踪', time: '次日清晨', characters: ['林澈'], location: '跨海轻轨站', event: '信号沿高架轨道向港区移动。', result: '', chapterId: null }
    ]
  } satisfies WorldMapView
}

test('map prompt uses only the author paper-cut brief and formal novel facts', () => {
  const result = buildWorldMapPrompt(source, 'paper-atlas')
  assert.match(result.prompt, /雾港来客/)
  assert.match(result.prompt, /旧校舍/)
  assert.match(result.prompt, /跨海轻轨站/)
  assert.match(result.prompt, /米白色纸张质感/)
  assert.match(result.prompt, /2.5D战术沙盘/)
  assert.doesNotMatch(result.prompt, /明日方舟|终末地/)
  assert.deepEqual(result.summary, { locations: 2, events: 2, characters: 2, sentCharacters: result.prompt.length })
})

test('paper atlas uses the approved palette, book era and landmark hierarchy without frozen selection or sample geography', () => {
  const paper = buildWorldMapPrompt(source, 'paper-atlas')
  assert.match(paper.prompt, /#F2EEE4/)
  assert.match(paper.prompt, /正交俯视角/)
  assert.match(paper.prompt, /现代地点使用现代建筑/)
  assert.match(paper.prompt, /局部校园、街区用对应局部空间表达/)
  assert.match(paper.prompt, /重要地点应当直接绘制具有辨识度/)
  assert.match(paper.prompt, /不画统一图钉、数字徽章、橙色路线、选中菱形或扫描圆环/)
  assert.match(paper.prompt, /旧校舍/)
  assert.doesNotMatch(paper.prompt, /北境哨站|赤砂边境/)
  for (const stylePreset of worldMapStylePresets) {
    const request = { operationId: 'a'.repeat(32), workItemId: 'novel-one', expectedRevision: 'a'.repeat(64), connectionId: 'image', model: 'test', stylePreset }
    if (stylePreset === 'paper-atlas') assert.equal(decodeWorldMapImageGenerateInput(request).stylePreset, stylePreset)
    else { assert.throws(() => decodeWorldMapImageGenerateInput(request)); assert.throws(() => buildWorldMapPrompt(source, stylePreset)) }
    assert.doesNotThrow(() => decodeWorldMapDocument({ version: 2, markers: [], background: { assetId: 'c'.repeat(64), format: 'png', width: 1536, height: 1024, stylePreset, model: 'old', generatedAt: '2026-09-09T08:00:00.000Z', sourceFingerprint: 'd'.repeat(64) } }))
  }
})

test('dense book trims whole source records, never truncates the author brief or negative constraints', () => {
  const large = { ...source, view: { ...source.view, events: Array.from({ length: 57 }, (_, i) => ({ ...source.view.events[0]!, id: `direct:${i}`, location: `地点${i}` + '地'.repeat(100), event: '事'.repeat(300), result: '果'.repeat(180), time: '时'.repeat(90) })) } }
  const result = buildWorldMapPrompt(large, 'paper-atlas')
  assert.ok(result.prompt.length <= 12000)
  assert.match(result.prompt, /深墨绿色 #17211E/)
  assert.match(result.prompt, /不要蓝紫色霓虹/)
  assert.ok(result.prompt.endsWith('不要把人物剪影当成正式角色设定。'))
  assert.ok(result.summary.events < 40)
})
