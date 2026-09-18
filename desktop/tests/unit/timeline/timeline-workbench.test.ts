import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTimelineCandidates, timelineEventTitle } from '../../../src/renderer/features/timeline/timeline-workbench'

test('derives a compact timeline title without binding it to a genre', () => {
  assert.equal(timelineEventTitle('主角在第四次远航后决定返乡。此后阵营关系改变。'), '主角在第四次远航后决定返乡')
  assert.equal(timelineEventTitle('任意正文', '议会否决返乡提案'), '议会否决返乡提案')
  assert.equal(timelineEventTitle(''), '未命名事件')
})

test('parses fenced AI timeline candidates, keeps the four required dimensions and removes duplicates', () => {
  const result = parseTimelineCandidates(`说明文字\n\`\`\`json
  [
    {"title":"钟声第一次倒流","time":"案发前三日","characters":["林舟","许岚"],"location":"旧钟楼","event":"两人在午夜听见倒流的钟声。","result":"决定分别调查钟楼的维修记录"},
    {"title":"重复项","time":"案发前三日","characters":"林舟、许岚","location":"旧钟楼","event":"两人在午夜听见倒流的钟声。","result":"不会保留"},
    {"title":"缺少地点","time":"次日","characters":"林舟","event":"这一项不完整"}
  ]
  \`\`\``)

  assert.deepEqual(result, [{
    title: '钟声第一次倒流',
    time: '案发前三日',
    characters: '林舟、许岚',
    location: '旧钟楼',
    event: '两人在午夜听见倒流的钟声。',
    result: '决定分别调查钟楼的维修记录'
  }])
})

test('rejects AI output that cannot become an editable event candidate', () => {
  assert.throws(() => parseTimelineCandidates('只有解释，没有 JSON'), /事件数组/)
  assert.throws(() => parseTimelineCandidates('[{"time":"第一日"}]'), /完整的时间、人物、地点和事件/)
})
