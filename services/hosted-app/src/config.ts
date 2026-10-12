import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface HostedConfig {
  origin: string
  dataDir: string
  masterKey: Buffer
  adminIds: ReadonlySet<string>
  host: string
  port: number
  development: boolean
  oauth?: { clientId: string; clientSecret: string }
}
function secretFile(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (!isAbsolute(path)) throw new Error('Secret file paths must be absolute.')
  return readFileSync(path, 'utf8').trim()
}
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const development = env.LANJIAN_DEVELOPMENT === '1'
  const origin = new URL(env.LANJIAN_PUBLIC_ORIGIN || (development ? 'http://127.0.0.1:43130' : 'https://invalid.invalid'))
  if (origin.origin === 'https://invalid.invalid' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    (origin.protocol !== 'https:' && !(development && origin.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)))) throw new Error('Configure an exact HTTPS LANJIAN_PUBLIC_ORIGIN.')
  const master = secretFile(env.LANJIAN_MASTER_KEY_FILE)
  if (!master || !/^[A-Za-z0-9+/]{43}=$/u.test(master) || Buffer.from(master, 'base64').length !== 32) throw new Error('LANJIAN_MASTER_KEY_FILE must contain a base64-encoded 32-byte key.')
  const adminIds = new Set((env.LANJIAN_ADMIN_LINUXDO_IDS || '').split(',').map(x => x.trim()).filter(Boolean))
  if ([...adminIds].some(x => !/^[1-9][0-9]{0,29}$/u.test(x))) throw new Error('Administrator IDs must be stable numeric Linux DO IDs.')
  const clientId = env.LINUXDO_CLIENT_ID?.trim(), clientSecret = secretFile(env.LINUXDO_CLIENT_SECRET_FILE)
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Configure both Linux DO client ID and secret file.')
  const port = Number(env.LANJIAN_PORT || 43130)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LANJIAN_PORT.')
  return { origin: origin.origin, dataDir: resolve(env.LANJIAN_DATA_DIR || 'data'), masterKey: Buffer.from(master, 'base64'),
    adminIds, host: env.LANJIAN_HOST || '127.0.0.1', port, development,
    ...(clientId && clientSecret ? { oauth: { clientId, clientSecret } } : {}) }
}
