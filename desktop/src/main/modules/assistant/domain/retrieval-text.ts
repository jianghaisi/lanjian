/** Comparison only: never persist this value as prose or use it as a quotation. */
export function normalizeRetrievalText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}
