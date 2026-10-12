/** Keep structural Markdown bytes intact; only collapse redundant empty lines
 * between unindented text outside fenced code. Whitespace-bearing lines may be
 * code/list indentation and are deliberately left alone. */
export function formatOutlineWhitespace(source: string): string {
  const parts = source.split(/(\r\n|\n|\r)/)
  const rows = Array.from({ length: Math.ceil(parts.length / 2) }, (_, i) => ({
    text: parts[i * 2] ?? '', ending: parts[i * 2 + 1] ?? ''
  }))
  let fence: { character: string; length: number } | null = null
  let result = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const marker = /^ {0,3}([\x60~]{3,})(.*)$/.exec(row.text)
    if (marker && [...marker[1]!].every(c => c === marker[1]![0])) {
      const run = marker[1]!
      if (!fence) fence = { character: run[0]!, length: run.length }
      else if (run[0] === fence.character && run.length >= fence.length && !marker[2]!.trim()) fence = null
      result += row.text + row.ending
      continue
    }
    if (!fence && row.text === '' && row.ending) {
      let end = i
      while (end + 1 < rows.length && rows[end + 1]!.text === '' && rows[end + 1]!.ending) end++
      const before = rows[i - 1]?.text
      const after = rows[end + 1]?.text
      const structural = /^(?:\s|[-+*>|]|\d+[.)]\s|[\x60~]{3})/
      if (end > i && before && after && !structural.test(before) && !structural.test(after)) {
        result += row.ending
        i = end
        continue
      }
    }
    result += row.text + row.ending
  }
  return result
}
