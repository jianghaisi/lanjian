import assert from 'node:assert/strict'
import test from 'node:test'
import { auditLiterarySuggestions } from '../../../src/main/modules/review/domain/literary-suggestions'

test('flags an exact duplicate paragraph as advice with paragraph evidence', () => {
  const repeated = '雨水顺着旧城墙往下淌，沈砚停在没有灯火的门洞里。'
  const findings = auditLiterarySuggestions(`${repeated}\n\n他听见远处有人敲了三下木鱼。\n\n${repeated}`, 8)
  const duplicate = findings.find((finding) => finding.code === 'DUPLICATE_PARAGRAPH')
  assert.equal(duplicate?.layer, 'literary')
  assert.equal(duplicate?.severity, 'advice')
  assert.equal(duplicate?.fromChapter, 8)
  assert.match(duplicate?.evidence.join('\n') || '', /第 1 段/)
  assert.match(duplicate?.evidence.join('\n') || '', /第 3 段/)
})

test('flags repeated paragraph openings while treating varied prose as clean', () => {
  const repeated = auditLiterarySuggestions([
    '沈砚抬头看见檐角落下一线冷雨，脚步却没有停。',
    '沈砚抬头看见城楼熄了最后一盏灯，手仍按着刀柄。',
    '沈砚抬头看见鸦群越过北门，才意识到天快亮了。'
  ].join('\n\n'), 3)
  assert.ok(repeated.some((finding) => finding.code === 'REPEATED_PARAGRAPH_OPENING'))

  const varied = auditLiterarySuggestions([
    '雨水顺着檐角落下，沈砚踩过积水走向北门。',
    '守门人抱紧长枪，只给他让出半步宽的缝隙。',
    '城外的鸦群忽然惊起，远处传来沉闷的马蹄声。'
  ].join('\n\n'), 3)
  assert.equal(varied.length, 0)
})

test('keeps summary-tone detection non-blocking and explicitly limited', () => {
  const findings = auditLiterarySuggestions('总而言之，他必须离开。\n\n由此可见，门后并不安全。\n\n事实上，他从未相信过那封信。', 4)
  const summary = findings.find((finding) => finding.code === 'SUMMARY_TONE_DENSITY')
  assert.equal(summary?.severity, 'advice')
  assert.match(summary?.message || '', /不代表文本质量结论/)
})
