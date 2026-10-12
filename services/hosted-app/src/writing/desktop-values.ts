import { isAbsolute, relative, sep } from 'node:path'
import { fail } from '../http/errors.ts'

const identityKeys = new Set(['workItemId', 'expectedWorkItemId', 'workItemPath', 'bookId', 'bookPath', 'project_root', 'root'])
const pathKeys = new Set(['path', 'filePath', 'absolutePath', 'sourcePath', 'targetPath', 'backupPath', 'targetParentPath'])

/** Transform structural metadata only. Author prose and arbitrary IDs stay exact. */
export function desktopPublicValue(value: unknown, root: string, bookId: string): unknown {
  const visit = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => visit(item, key))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child, name)]))
    if (typeof value !== 'string') return value
    if (value === root && (identityKeys.has(key) || pathKeys.has(key) || key === 'id' || key === 'sourceId')) return bookId
    if (pathKeys.has(key) && isAbsolute(value)) {
      const local = relative(root, value)
      if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) fail('internal-error')
      return `${bookId}/${local.split(sep).join('/')}`
    }
    return value
  }
  return visit(value)
}

/** Book identity fields must name the authenticated URL book before core decoding. */
export function desktopPrivateArgs(args: unknown[], root: string, bookId: string): unknown[] {
  const visit = (value: unknown, key = '', parent = ''): unknown => {
    if (typeof value === 'string' && (identityKeys.has(key) || parent === 'workItem' && (key === 'id' || key === 'path'))) {
      if (value !== bookId) fail('not-found')
      return root
    }
    if (Array.isArray(value)) return value.map(item => visit(item, key, parent))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, visit(child, name, key)]))
    if (typeof value === 'string' && pathKeys.has(key) && (isAbsolute(value) || /^[A-Za-z]:[\\/]|^\\\\/.test(value))) fail('invalid-request')
    return value
  }
  return args.map(arg => visit(arg))
}
