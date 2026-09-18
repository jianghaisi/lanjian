import type { WritingAgentDiffBlock } from '../index'

type DiffOperation = { kind: 'equal' | 'delete' | 'insert'; value: string }
const maxComparedTokens = 500
const maxComparisonCells = 250_000

export function buildWritingAgentDiff(before: string, after: string, granularity: 'semantic' | 'character' = 'semantic'): WritingAgentDiffBlock[] {
  if (before === after) return [{ id: 'diff-1', kind: 'equal', before, after }]
  const left = granularity === 'character' ? Array.from(before) : semanticTokens(before)
  const right = granularity === 'character' ? Array.from(after) : semanticTokens(after)
  if (left.length > maxComparedTokens || right.length > maxComparedTokens || left.length * right.length > maxComparisonCells) {
    return [{ id: 'diff-1', kind: 'change', before, after }]
  }
  const operations = lcsOperations(left, right)
  const blocks: WritingAgentDiffBlock[] = []
  let beforeText = ''
  let afterText = ''
  let activeKind: WritingAgentDiffBlock['kind'] | null = null
  const flush = () => {
    if (!activeKind) return
    blocks.push({ id: `diff-${blocks.length + 1}`, kind: activeKind, before: beforeText, after: afterText })
    beforeText = ''
    afterText = ''
  }
  for (const operation of operations) {
    const kind = operation.kind === 'equal' ? 'equal' : 'change'
    if (activeKind !== kind) {
      flush()
      activeKind = kind
    }
    if (operation.kind !== 'insert') beforeText += operation.value
    if (operation.kind !== 'delete') afterText += operation.value
  }
  flush()
  return blocks.length ? blocks : [{ id: 'diff-1', kind: 'change', before, after }]
}

export function mergeWritingAgentDiff(blocks: WritingAgentDiffBlock[], acceptedChangeIds: ReadonlySet<string>): string {
  validateBlocks(blocks)
  return blocks.map((block) => block.kind === 'equal' || acceptedChangeIds.has(block.id) ? block.after : block.before).join('')
}

function semanticTokens(value: string): string[] {
  if (!value) return []
  const tokens: string[] = []
  let buffer = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    buffer += character
    if ('。！？!?；;'.includes(character)) {
      tokens.push(buffer)
      buffer = ''
    } else if (character === '\r' && value[index + 1] === '\n') {
      buffer += value[++index]
      tokens.push(buffer)
      buffer = ''
    } else if (character === '\n') {
      tokens.push(buffer)
      buffer = ''
    }
  }
  if (buffer) tokens.push(buffer)
  return tokens
}

function lcsOperations(left: string[], right: string[]): DiffOperation[] {
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1))
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1])
    }
  }
  const operations: DiffOperation[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({ kind: 'equal', value: left[leftIndex] })
      leftIndex += 1
      rightIndex += 1
    } else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      operations.push({ kind: 'delete', value: left[leftIndex++] })
    } else {
      operations.push({ kind: 'insert', value: right[rightIndex++] })
    }
  }
  while (leftIndex < left.length) operations.push({ kind: 'delete', value: left[leftIndex++] })
  while (rightIndex < right.length) operations.push({ kind: 'insert', value: right[rightIndex++] })
  return operations
}

function validateBlocks(blocks: WritingAgentDiffBlock[]): void {
  if (!blocks.length || new Set(blocks.map((block) => block.id)).size !== blocks.length
    || blocks.some((block) => !block.id || !['equal', 'change'].includes(block.kind))) {
    throw new Error('invalid writing diff')
  }
}
