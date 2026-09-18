import { realpath, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { AppError } from '../../core/errors/app-error'

export async function canonicalDirectory(path: string): Promise<string> {
  const value = await realpath(resolve(path))
  if (!(await stat(value)).isDirectory()) {
    throw new AppError('VALIDATION_ERROR', '所选路径不是文件夹', { recoverable: true })
  }
  return value
}

export async function projectDirectory(root: string, candidate: string): Promise<string> {
  const absolute = lexicalInside(root, candidate)
  try {
    const existing = await realpath(absolute)
    assertRealInside(await realpath(resolve(root)), existing)
  } catch (error) {
    if (!missing(error)) throw error
    await assertTargetParent(root, absolute)
  }
  return absolute
}

export async function projectExistingPath(root: string, candidate: string): Promise<string> {
  const absolute = lexicalInside(root, candidate)
  const [realRoot, realCandidate] = await Promise.all([realpath(resolve(root)), realpath(absolute)])
  assertRealInside(realRoot, realCandidate)
  return absolute
}

export async function projectTargetPath(root: string, candidate: string): Promise<string> {
  const absolute = lexicalInside(root, candidate)
  await assertTargetParent(root, absolute)
  return absolute
}

/** Synchronous counterpart for the existing synchronous SQLite version reader. */
export function projectExistingPathSync(root: string, candidate: string): string {
  const absolute = lexicalInside(root, candidate)
  assertRealInside(realpathSync(resolve(root)), realpathSync(absolute))
  return absolute
}

export function projectTargetPathSync(root: string, candidate: string): string {
  const absolute = lexicalInside(root, candidate)
  const realRoot = realpathSync(resolve(root))
  let ancestor = dirname(absolute)
  while (true) {
    try { assertRealInside(realRoot, realpathSync(ancestor)); return absolute }
    catch (error) {
      if (!missing(error)) throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      ancestor = parent
    }
  }
}

async function assertTargetParent(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(resolve(root))
  let ancestor = dirname(candidate)
  while (true) {
    try {
      assertRealInside(realRoot, await realpath(ancestor))
      return
    } catch (error) {
      if (!missing(error)) throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      ancestor = parent
    }
  }
}

function lexicalInside(root: string, candidate: string): string {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(candidate)
  assertRelativeInside(absoluteRoot, absoluteCandidate)
  return absoluteCandidate
}

function assertRealInside(root: string, candidate: string): void {
  assertRelativeInside(normalizeCase(root), normalizeCase(candidate))
}

function assertRelativeInside(root: string, candidate: string): void {
  const value = relative(root, candidate)
  if (value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))) return
  throw new AppError('PATH_ESCAPE', '文件路径超出了当前项目目录')
}

function normalizeCase(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
