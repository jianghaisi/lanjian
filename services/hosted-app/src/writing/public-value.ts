/** Project roots are private capabilities; prose itself is never rewritten. */
export function publicValue(value: unknown, root: string, bookId: string): unknown {
  return JSON.parse(JSON.stringify(value, (key, value: unknown) => {
    if (typeof value !== 'string') return value
    if (['id', 'workItemId', 'workItemPath', 'bookPath', 'root', 'project_root', 'path', 'sourceId'].includes(key) && value === root) return bookId
    if (['filePath', 'absolutePath', 'targetParentPath'].includes(key)) return undefined
    return value
  })) as unknown
}
