const LEADING_WHITESPACE = /^[\t \u3000]+/

export type ManuscriptFormattingOptions = {
  firstLineIndent?: boolean
  paragraphSpacing?: boolean
}

/**
 * Normalise novel prose without guessing that adjacent source lines belong to
 * the same paragraph. Generated manuscripts commonly use one newline between
 * paragraphs, while pasted manuscripts may use blank lines; both forms must
 * keep their paragraph boundaries.
 */
export function formatManuscriptParagraphs(source: string, options: ManuscriptFormattingOptions = {}): string {
  const { firstLineIndent = true, paragraphSpacing = true } = options
  const prefix = firstLineIndent ? '　　' : ''
  const separator = paragraphSpacing ? '\n\n' : '\n'
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(LEADING_WHITESPACE, ''))
    .filter(Boolean)
    .map((paragraph) => `${prefix}${paragraph}`)
    .join(separator)
}
