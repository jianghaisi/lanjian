import { record, text } from '@lanjian/hosted-contracts'
import type { ProviderIdentity } from './identity-service.ts'
import { fail } from '../http/errors.ts'

export interface OAuthProvider { authorizationUrl(state: string): string; exchange(code: string): Promise<ProviderIdentity> }
export async function boundedJson(response: Response, limit = 65536): Promise<unknown> {
  if (!response.ok || !response.body) fail('oauth-failed')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); fail('oauth-failed') }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally { reader.releaseLock() }
}
export function linuxDoIdentity(value: unknown): ProviderIdentity {
  const profile = record(value)
  const subject = typeof profile.id === 'number' && Number.isSafeInteger(profile.id) ? String(profile.id) : profile.id
  if (typeof subject !== 'string' || !/^[1-9][0-9]{0,29}$/u.test(subject) || profile.active === false || profile.silenced === true) fail('oauth-failed')
  return { subject, username: text(profile.username, 100), name: text(profile.name || profile.username, 200) }
}
