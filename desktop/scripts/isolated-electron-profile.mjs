import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const prefix = 'lanjian-evaluation-runtime-'

/** Prepare BEFORE spawning Electron: OSCrypt initializes before app.whenReady. */
export async function prepareEvaluationRuntime(sourceProfile) {
  const parent = await realpath(tmpdir())
  const path = await mkdtemp(join(parent, prefix))
  try {
    if (process.platform === 'win32' && sourceProfile) {
      const source = await realpath(sourceProfile)
      const state = JSON.parse(await readFile(join(source, 'Local State'), 'utf8'))
      const encryptedKey = state.os_crypt?.encrypted_key
      if (typeof encryptedKey !== 'string' || !encryptedKey) throw new Error('Profile encryption context unavailable')
      // Copy only the OS-protected wrapping key, never cookies, browser state,
      // API credentials or plaintext. Electron/Windows still performs decryption.
      await writeFile(join(path, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: encryptedKey } }), { mode: 0o600 })
    }
    return path
  } catch (error) {
    await removeEvaluationRuntime(path)
    throw error
  }
}

export async function removeEvaluationRuntime(path) {
  const target = await realpath(path)
  const parent = await realpath(tmpdir())
  if (dirname(target) !== parent || !basename(target).startsWith(prefix)) throw new Error('Unexpected evaluation runtime path')
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
