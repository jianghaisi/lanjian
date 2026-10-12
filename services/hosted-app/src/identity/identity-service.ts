import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { defaultWelcomeCredits, decodeUser, text, type UserView } from '@lanjian/hosted-contracts'
import type { HostedConfig } from '../config.ts'
import { HostedDatabase, dbString } from '../storage/database.ts'
import { fail } from '../http/errors.ts'

export type ProviderIdentity = { subject: string; username: string; name: string }
export type Authenticated = { user: UserView; token: string; csrf: string }
export const sessionSeconds = 7 * 24 * 3600
export function validToken(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{43}$/u.test(value) }
export class IdentityService {
  constructor(readonly db: HostedDatabase, readonly config: HostedConfig) {}
  private user(row: Record<string, unknown>): UserView {
    return decodeUser({ id: row.id, username: row.username, name: row.name, role: row.role, disabled: row.disabled === 1 })
  }
  get(id: string): UserView {
    const row = this.db.get('SELECT * FROM users WHERE id=?', id)
    if (!row) fail('not-found')
    return this.user(row)
  }
  list(): (UserView & { subject: string })[] {
    return this.db.all('SELECT * FROM users ORDER BY created_at DESC LIMIT 500').map(row => ({ ...this.user(row), subject: dbString(row.subject) }))
  }
  ensureUser(profile: ProviderIdentity): UserView {
    if (!/^[1-9][0-9]{0,29}$/u.test(profile.subject)) fail('oauth-failed')
    const username = text(profile.username, 100), name = text(profile.name || username, 200)
    return this.db.transaction(() => {
      const role = this.config.adminIds.has(profile.subject) ? 'admin' : 'member'
      const existing = this.db.get('SELECT * FROM users WHERE subject=?', profile.subject)
      if (existing?.disabled === 1) fail('account-disabled')
      const id = existing ? dbString(existing.id) : randomUUID()
      if (existing) {
        if (existing.username !== username || existing.name !== name || existing.role !== role) this.db.run('UPDATE users SET username=?,name=?,role=? WHERE id=?', username, name, role, id)
      }
      else {
        this.db.run('INSERT INTO users(id,subject,username,name,role,created_at) VALUES(?,?,?,?,?,?)', id, profile.subject, username, name, role, this.db.now())
        this.db.run('INSERT INTO wallets(user_id,balance) VALUES(?,?)', id, defaultWelcomeCredits)
        this.db.run('INSERT INTO ledger VALUES(?,?,?,?,?,?,?)', randomUUID(), id, 'welcome', defaultWelcomeCredits, '首次登录赠送 10 积分', 'system', this.db.now())
        this.db.audit('system', 'welcome', id, { amount: defaultWelcomeCredits })
      }
      return this.get(id)
    })
  }
  resolve(profile: ProviderIdentity, token: string): Authenticated {
    // Only called with a server-verified Better Auth session, never browser data.
    const user = this.ensureUser(profile)
    return { user, token, csrf: createHmac('sha256', this.config.masterKey).update('csrf:').update(token).digest('base64url') }
  }
  csrf(auth: Authenticated, origin: unknown, value: unknown): void {
    if (origin !== this.config.origin || !validToken(value) || !timingSafeEqual(Buffer.from(value), Buffer.from(auth.csrf))) fail('csrf-invalid')
  }
  setDisabled(actor: string, id: string, disabled: boolean): UserView {
    return this.db.transaction(() => {
      const user = this.get(id)
      if (actor === id || user.role === 'admin') fail('conflict')
      this.db.run('UPDATE users SET disabled=? WHERE id=?', disabled ? 1 : 0, id)
      this.db.audit(actor, 'user-status', id, { disabled })
      return this.get(id)
    })
  }
}
