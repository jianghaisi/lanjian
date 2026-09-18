import { realpath } from 'node:fs/promises'
import { AppError } from '../../../core/errors/app-error'
import { defaultLegacyBookModelSettings, parseBookModelSettings } from '../domain/book-model-settings'
import { bookModelRequestConflict, bookModelSourceUnavailable, type BookModelSourceReader, type BookModelSnapshot } from '../domain/book-model-resolution'
import { modelBookIdentity, modelSourceHash, readAiAuthority } from './ai-settings-read-snapshot'
import { readModelConnectionFile } from './model-connection-file'

/** No credential, catalog, SettingsStore or write-capable database dependency. */
export class FileBookModelSource implements BookModelSourceReader {
  async capture(bookRoot: string): Promise<BookModelSnapshot> {
    const observed = await this.observe(bookRoot)
    const assertCurrent = async () => {
      const current = await this.observe(bookRoot)
      if (current.sourceIdentity !== observed.sourceIdentity || current.documentFingerprint !== observed.documentFingerprint) throw bookModelRequestConflict()
    }
    await assertCurrent()
    return { ...observed, assertCurrent }
  }

  private async observe(bookRoot: string) {
    try {
      const sourceIdentity = await modelBookIdentity(bookRoot), root = await realpath(bookRoot)
      const authority = await readAiAuthority(root)
      const file = authority.formal ? null : await readModelConnectionFile(root, '.webnovel/ai-settings.json')
      const content = authority.formal ? authority.content : file?.content
      const settings = content === undefined ? defaultLegacyBookModelSettings() : parseBookModelSettings(content)
      if (await modelBookIdentity(bookRoot) !== sourceIdentity) throw bookModelRequestConflict()
      return { bookRoot: root, sourceIdentity, settings, storage: authority.storage, fileHash: file?.fingerprint ?? null,
        documentFingerprint: modelSourceHash(JSON.stringify([sourceIdentity, authority.documentFingerprint, file?.fingerprint ?? null])) }
    } catch (error) {
      if (error instanceof AppError && ['CONFLICT', 'VALIDATION_ERROR', 'FEATURE_UNAVAILABLE'].includes(error.code)) throw error
      throw bookModelSourceUnavailable()
    }
  }
}
