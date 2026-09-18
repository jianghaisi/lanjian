import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { decodeLegacyConnections, decodeLegacyReusePreview, selectedLegacyCredentials, legacyReuseConflict,
  type LegacyConnectionSource, type LegacyConnectionSnapshot } from '../domain/legacy-connection-reuse'
import { readAiAuthority } from './ai-settings-read-snapshot'
import { readModelConnectionFile } from './model-connection-file'

/** Read-only source acquisition. No SettingsStore/ProjectAiService/write-capable DB dependency. */
export class FileLegacyConnectionSource implements LegacyConnectionSource {
  constructor(private readonly userData: string) {
    if (!isAbsolute(userData)) throw unavailableSource()
  }

  async identity(bookRoot: string): Promise<string> {
    try {
      if (!isAbsolute(bookRoot)) throw unavailableSource()
      const root = await realpath(bookRoot), info = await stat(root, { bigint: true })
      if (!info.isDirectory()) throw unavailableSource()
      return hash(JSON.stringify([process.platform === 'win32' ? root.toLowerCase() : root, String(info.ino), String(info.birthtimeNs)]))
    } catch { throw unavailableSource() }
  }

  async capture(bookRoot: string, ids: string[]): Promise<LegacyConnectionSnapshot> {
    const selected = decodeLegacyReusePreview({ selectedIds: ids, expectedRevision: 0 }).selectedIds
    const observed = await this.observe(bookRoot, selected)
    const assertCurrent = async () => {
      const current = await this.observe(bookRoot, selected)
      if (current.sourceIdentity !== observed.sourceIdentity || current.sourceFingerprint !== observed.sourceFingerprint) throw legacyReuseConflict()
    }
    await assertCurrent()
    return { ...observed, assertCurrent }
  }

  private async observe(bookRoot: string, selectedIds: string[]) {
    try {
      const sourceIdentity = await this.identity(bookRoot)
      const root = await realpath(bookRoot), appRoot = await realpath(this.userData)
      const authority = await readAiAuthority(root)
      const file = authority.formal ? null : await readModelConnectionFile(root, '.webnovel/ai-settings.json')
      const value = authority.formal ? authority.value : file?.value
      if (!value) throw unavailableSource()
      const connections = decodeLegacyConnections(value)
      const settings = await readModelConnectionFile(appRoot, 'settings.json')
      const credentials = selectedLegacyCredentials(settings?.value ?? {}, root, selectedIds)
      const selected = selectedIds.map(id => {
        const connection = connections.find(c => c.id === id)
        if (!connection) throw legacyReuseConflict()
        const encryptedApiKey = credentials.get(id)
        return { ...connection, ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }) }
      })
      if (await this.identity(bookRoot) !== sourceIdentity || await realpath(this.userData) !== appRoot) throw legacyReuseConflict()
      return { sourceIdentity, connections: selected, sourceFingerprint: hash(JSON.stringify([
        sourceIdentity, authority.fingerprint, file?.fingerprint ?? null, settings?.fingerprint ?? null, selectedIds
      ])) }
    } catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') throw legacyReuseConflict()
      throw unavailableSource()
    }
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function unavailableSource(): AppError {
  return new AppError('STORAGE_ERROR', '无法安全读取旧接口来源，请检查作品和应用配置后重试；原文件未改动。', { recoverable: true })
}
