import type { ConsistencyFinding } from '../../../../contracts/index'

type Paragraph = { index: number; text: string; normalized: string }

export function auditLiterarySuggestions(content: string, chapterPosition: number): ConsistencyFinding[] {
  const paragraphs = content.split(/\r?\n+/)
    .map((text, index) => ({ index: index + 1, text: text.trim(), normalized: normalize(text) }))
    .filter((paragraph) => paragraph.normalized.length >= 12)
  if (!paragraphs.length) return []
  return [
    ...duplicateParagraphFindings(paragraphs, chapterPosition),
    ...repeatedOpeningFindings(paragraphs, chapterPosition),
    ...summaryToneFindings(content, chapterPosition)
  ].slice(0, 20)
}

function duplicateParagraphFindings(paragraphs: Paragraph[], chapterPosition: number): ConsistencyFinding[] {
  const positions = new Map<string, Paragraph[]>()
  for (const paragraph of paragraphs) {
    const group = positions.get(paragraph.normalized) || []
    group.push(paragraph)
    positions.set(paragraph.normalized, group)
  }
  return [...positions.values()]
    .filter((group) => group.length > 1)
    .slice(0, 5)
    .map((group) => literaryFinding(
      'DUPLICATE_PARAGRAPH', chapterPosition,
      `第 ${group.map((entry) => entry.index).join('、')} 段内容完全重复，可能是粘贴或合并草稿时留下的重复段落。`,
      group.slice(0, 3).map((entry) => `第 ${entry.index} 段：${entry.text.slice(0, 300)}`)
    ))
}

function repeatedOpeningFindings(paragraphs: Paragraph[], chapterPosition: number): ConsistencyFinding[] {
  // Short Chinese web-fiction paragraphs are common; 16 normalized characters
  // still provide enough material to avoid treating headings or one-line beats
  // as paragraph-opening evidence.
  const eligible = paragraphs.filter((paragraph) => paragraph.normalized.length >= 16)
  const groups = new Map<string, Paragraph[]>()
  for (const paragraph of eligible) {
    const opening = paragraph.normalized.slice(0, 4)
    const group = groups.get(opening) || []
    group.push(paragraph)
    groups.set(opening, group)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length >= 3)
    .slice(0, 3)
    .map(([opening, group]) => literaryFinding(
      'REPEATED_PARAGRAPH_OPENING', chapterPosition,
      `${group.length} 个段落都以“${opening}…”起笔，读感可能显得机械；如果这是刻意排比，可以保留。`,
      group.slice(0, 4).map((entry) => `第 ${entry.index} 段：${entry.text.slice(0, 180)}`)
    ))
}

function summaryToneFindings(content: string, chapterPosition: number): ConsistencyFinding[] {
  const cues = ['总而言之', '由此可见', '显而易见', '不得不说', '事实上']
  const hits = cues.flatMap((cue) => Array.from(content.matchAll(new RegExp(cue, 'g')), () => cue))
  if (hits.length < 3) return []
  return [literaryFinding(
    'SUMMARY_TONE_DENSITY', chapterPosition,
    `本章出现 ${hits.length} 处总结性连接语，可能削弱场景的即时感；这只是表达提示，不代表文本质量结论。`,
    [...new Set(hits)].map((cue) => `命中：“${cue}”`)
  )]
}

function literaryFinding(code: Extract<ConsistencyFinding['code'], 'DUPLICATE_PARAGRAPH' | 'REPEATED_PARAGRAPH_OPENING' | 'SUMMARY_TONE_DENSITY'>, chapterPosition: number, message: string, evidence: string[]): ConsistencyFinding {
  return {
    code,
    layer: 'literary',
    severity: 'advice',
    message,
    characterId: 'chapter-style',
    characterName: '正文表达',
    fromChapter: chapterPosition,
    toChapter: chapterPosition,
    evidence
  }
}

function normalize(value: string): string {
  return value.replace(/[\s，。、“”‘’：:；;！？!?（）()【】\[\]—…·]/g, '').toLocaleLowerCase('zh-CN')
}
