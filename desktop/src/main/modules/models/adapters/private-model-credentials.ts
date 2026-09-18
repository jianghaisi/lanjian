import { realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { bookModelRequestConflict, bookModelSourceUnavailable, type PrivateModelCredentialReader } from '../domain/book-model-resolution'
import { legacyConnectionId, selectedLegacyCredentials } from '../domain/legacy-connection-reuse'
import { modelBookIdentity } from './ai-settings-read-snapshot'
import { readModelConnectionFile } from './model-connection-file'

/** Exact canonical book/original-ID lookup. No app-ai fallback, decrypt or write. */
export class FilePrivateModelCredentials implements PrivateModelCredentialReader {
  constructor(private readonly userData: string) {
    if (!isAbsolute(userData)) throw bookModelSourceUnavailable()
  }
  async capture(bookRoot: string, originalConnectionId: string) {
    const id = legacyConnectionId(originalConnectionId)
    const observe = async () => {
      try {
        const identity = await modelBookIdentity(this.userData), appRoot = await realpath(this.userData)
        const value = await readModelConnectionFile(appRoot, 'settings.json')
        const encryptedApiKey = selectedLegacyCredentials(value?.value ?? {}, bookRoot, [id]).get(id)
        if (await modelBookIdentity(this.userData) !== identity) throw bookModelRequestConflict()
        return { identity, encryptedApiKey }
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONFLICT') throw error
        throw bookModelSourceUnavailable()
      }
    }
    const captured = await observe()
    if (!captured.encryptedApiKey) throw new AppError('FEATURE_UNAVAILABLE', '此作品接口尚未配置密钥，请先配置后重试。', { recoverable: true })
    const assertCurrent = async () => {
      const next = await observe()
      if (next.identity !== captured.identity || next.encryptedApiKey !== captured.encryptedApiKey) throw bookModelRequestConflict()
    }
    await assertCurrent()
    return { encryptedApiKey: captured.encryptedApiKey, assertCurrent }
  }
}
