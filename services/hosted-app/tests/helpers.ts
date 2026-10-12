import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { TestContext } from 'node:test'
import { HostedDatabase } from '../src/storage/database.ts'
import { buildApp } from '../src/http/app.ts'
import type { HostedConfig } from '../src/config.ts'
import type { ProviderIdentity } from '../src/identity/identity-service.ts'

export function fixture(t: TestContext, modelFetcher?: typeof fetch) {
  const root = mkdtempSync(join(tmpdir(), 'lanjian-hosted-test-'))
  let time = Date.now()
  const config: HostedConfig = { origin: 'https://novel.example', dataDir: root, masterKey: randomBytes(32),
    adminIds: new Set(['42']), host: '127.0.0.1', port: 43130, development: false, oauth: { clientId: 'fixture', clientSecret: 'secret-sentinel' } }
  const db = new HostedDatabase(root, () => time)
  let calls = 0
  let profile: ProviderIdentity = { subject: '123', username: 'writer', name: '作者' }
  let failure = false
  const instance = buildApp({ config, database: db, modelFetcher, oauth: {
    authorizationUrl(state) { return `https://connect.linux.do/oauth2/authorize?state=${state}` },
    async exchange() { calls++; if (failure) throw new Error('secret-sentinel C:\\private\\keys bearer-secret'); return profile }
  } })
  t.after(async () => { await instance.app.close(); db.close(); rmSync(root, { recursive: true, force: true }) })
  async function login(subject = '123') {
    profile = { subject, username: `writer${subject}`, name: '测试作者' }
    const start = await instance.app.inject({ url: '/api/auth/linuxdo/start' })
    const state = new URL(start.headers.location!).searchParams.get('state')!
    const browser = Object.fromEntries(start.cookies.map(c => [c.name, c.value]))
    const callback = await instance.app.inject({ url: `/api/auth/linuxdo/callback?state=${state}&code=fixture`, cookies: browser })
    const token = callback.cookies.find(c => c.name.endsWith('.session_token'))?.value
    if (!token) throw new Error(`Fixture login failed (${callback.statusCode}): ${callback.body} ${callback.headers.location}.`)
    const cookies = Object.fromEntries(callback.cookies.filter(c => c.value).map(c => [c.name, c.value]))
    const me = (await instance.app.inject({ url: '/api/me', cookies })).json()
    return { cookies, me, headers: { origin: config.origin, 'x-csrf-token': me.csrfToken as string }, token }
  }
  return { ...instance, root, config, login, advance(ms: number) { time += ms }, calls: () => calls,
    profile(value: ProviderIdentity) { profile = value }, failProvider() { failure = true } }
}
