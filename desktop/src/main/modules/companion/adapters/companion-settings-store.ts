import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { AppError } from '../../../core/errors/app-error'
import { decodeCompanionSettings, decodeCompanionSettingsPatch, decodeVoicePreferences, defaultCompanionSettings, type CompanionSettings, type CompanionSettingsPatch, type CompanionVoicePreferences } from '../../../../contracts/companion/companion-settings'

export class CompanionSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly file: string
  constructor(private readonly directory: string, private readonly write = atomicWriteText) {
    if (!isAbsolute(directory)) throw new Error('SETTINGS_DIRECTORY_INVALID')
    this.file = join(directory, 'companion-settings.json')
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.then(operation); this.queue = next.catch(() => {}); return next }
  private async readNow(): Promise<CompanionSettings> {
    try {
      const info = await lstat(this.file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error('SETTINGS_FILE_INVALID')
      return decodeCompanionSettings(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
        const names = await readdir(this.directory).catch(reason => { if (reason?.code === 'ENOENT') return []; throw new AppError('STORAGE_ERROR', '伙伴设置目录暂不可读，请重试。', { recoverable: true, cause: reason }) })
        if (!names.some(name => name.startsWith('companion-settings.json.') && name.endsWith('.efs-backup'))) return defaultCompanionSettings()
      }
      throw new AppError('STORAGE_ERROR', '伙伴设置无法读取，原文件已保留。可备份原记录后恢复默认设置。', { recoverable: true, cause })
    }
  }
  read(): Promise<CompanionSettings> { return this.exclusive(() => this.readNow()) }
  update(patch: CompanionSettingsPatch): Promise<CompanionSettings> {
    const change = structuredClone(decodeCompanionSettingsPatch(patch))
    return this.exclusive(async () => {
      const before = await this.readNow()
      return this.save({ ...before, ...change, voice: { ...before.voice, ...change.voice }, revision: before.revision + 1 })
    })
  }
  importVoice(voice: CompanionVoicePreferences): Promise<CompanionSettings> {
    const snapshot = structuredClone(decodeVoicePreferences(voice)) as CompanionVoicePreferences
    return this.exclusive(async () => {
      const before = await this.readNow()
      return before.revision > 0 ? before : this.save({ ...before, voice: snapshot, revision: 1 })
    })
  }
  recover(): Promise<CompanionSettings> {
    return this.exclusive(async () => {
      let revision = Date.now()
      try {
        const info = await lstat(this.file)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('SETTINGS_FILE_INVALID')
        try { revision = Math.max(revision, (await this.readNow()).revision + 1) } catch { /* preserve corrupt bytes below */ }
        await copyFile(this.file, `${this.file}.${randomUUID()}.bak`)
      } catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')) throw new AppError('STORAGE_ERROR', '未能备份原设置，已取消恢复。', { recoverable: true, cause }) }
      return this.save({ ...defaultCompanionSettings(), revision })
    })
  }
  private async save(value: CompanionSettings): Promise<CompanionSettings> {
    try { await mkdir(this.directory, { recursive: true }); await this.write(this.file, `${JSON.stringify(decodeCompanionSettings(value), null, 2)}\n`); return structuredClone(value) }
    catch (cause) { throw new AppError('STORAGE_ERROR', '伙伴设置尚未保存，请重试。', { recoverable: true, cause }) }
  }
}
