import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { atomicWriteBuffer } from '../../../platform/storage/atomic-file'
import type { PluginExportDestination } from '../domain/authoring'

const conflict = (): never => { throw new AppError('CONFLICT', '保存位置或文件已变化，请重新选择导出位置。', { recoverable: true }) }
const inside = (root: string, path: string) => { const part = relative(root, path); return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)) }
async function fileIdentity(path: string) {
  try {
    const stat = await lstat(path, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink()) return conflict()
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause }
}

/** Only the native save dialog supplies this path. It never enters a DTO or tool result. */
export async function pluginExportDestination(selectedPath: string, protectedRoot: string): Promise<PluginExportDestination> {
  try {
    const selected = resolve(selectedPath), fileName = basename(selected)
    if (extname(selected).toLowerCase() !== '.zip' || fileName.length > 255 || /[\\/:\u0000-\u001f]/.test(fileName)) {
      throw new AppError('VALIDATION_ERROR', '请选择 ZIP 插件包文件名。', { recoverable: true })
    }
    const parent = await realpath(dirname(selected)), root = await realpath(protectedRoot)
    const target = join(parent, fileName), parentStat = await lstat(parent, { bigint: true })
    if (inside(root, target) || !parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new AppError('VALIDATION_ERROR', '请将插件包保存到应用数据目录以外。', { recoverable: true })
    }
    const original = await fileIdentity(target)
    return { fileName, async write(bytes, beforeCommit) {
      const check = async () => {
        await beforeCommit()
        const current = await lstat(parent, { bigint: true })
        if (await realpath(dirname(selected)) !== parent || await realpath(parent) !== parent || current.isSymbolicLink() || !current.isDirectory() || current.dev !== parentStat.dev || current.ino !== parentStat.ino || await fileIdentity(target) !== original) conflict()
      }
      try { await check(); await atomicWriteBuffer(target, bytes, check) }
      catch (cause) {
        if (cause instanceof AppError) throw cause
        throw new AppError('STORAGE_ERROR', '插件包未能保存，请检查保存位置后重试。草稿已保留。', { recoverable: true, cause })
      }
    } }
  } catch (cause) {
    if (cause instanceof AppError) throw cause
    throw new AppError('STORAGE_ERROR', '无法使用所选保存位置，请重新选择。', { recoverable: true, cause })
  }
}
