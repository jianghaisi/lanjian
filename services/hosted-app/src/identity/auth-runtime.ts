import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { getMigrations } from 'better-auth/db/migration'
import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyRequest } from 'fastify'
import type { HostedConfig } from '../config.ts'
import { IdentityService, sessionSeconds } from './identity-service.ts'
import { boundedJson, linuxDoIdentity, type OAuthProvider } from './linuxdo.ts'
import { fail } from '../http/errors.ts'

export function createAuthRuntime(config: HostedConfig, identity: IdentityService, provider?: OAuthProvider) {
  const database = new DatabaseSync(join(config.dataDir, 'auth.sqlite'), { allowExtension: false })
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
  if (version > 1) { database.close(); throw new Error('Unsupported authentication database version.') }
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;')
  const auth = betterAuth({
    appName: '岚笺', baseURL: config.origin, basePath: '/api/auth', database,
    secret: createHmac('sha256', config.masterKey).update('lanjian:better-auth:v1').digest('base64url'),
    trustedOrigins: [config.origin], logger: { disabled: true }, telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    session: { expiresIn: sessionSeconds, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: !config.development, cookiePrefix: 'lanjian-auth',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' } },
    account: { encryptOAuthTokens: true, storeStateStrategy: 'database', accountLinking: { enabled: false, disableImplicitLinking: true } },
    // Generic OAuth maps additional profile fields through its input schema.
    // No public sign-up, update-user or account-linking handler is registered.
    user: { additionalFields: { linuxdoSubject: { type: 'string', required: true, input: true }, linuxdoUsername: { type: 'string', required: true, input: true } } },
    onAPIError: { errorURL: `${config.origin}/app?login=failed` },
    plugins: [genericOAuth({ config: config.oauth ? [{
      providerId: 'linuxdo', clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
      authorizationUrl: 'https://connect.linux.do/oauth2/authorize', tokenUrl: 'https://connect.linux.do/oauth2/token',
      redirectURI: `${config.origin}/api/auth/linuxdo/callback`, authentication: 'basic', overrideUserInfo: true,
      ...(provider ? { getToken: async ({ code }: { code: string }) => ({ accessToken: code }) } : {}),
      async getUserInfo(tokens) {
        try {
          const profile = provider ? await provider.exchange(tokens.accessToken!) : linuxDoIdentity(await boundedJson(await fetch('https://connect.linux.do/api/user', {
            headers: { authorization: `Bearer ${tokens.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(15000)
          })))
          if (identity.db.get('SELECT disabled FROM users WHERE subject=?', profile.subject)?.disabled === 1) return null
          // A non-deliverable internal identifier; email sign-in/linking is disabled.
          return { id: profile.subject, name: profile.name, email: `${profile.subject}@linuxdo.invalid`, emailVerified: false,
            linuxdoSubject: profile.subject, linuxdoUsername: profile.username }
        } catch { return null }
      },
      mapProfileToUser(profile) { return { linuxdoSubject: profile.linuxdoSubject, linuxdoUsername: profile.linuxdoUsername } }
    }] : [] })]
  })
  const headers = (request: FastifyRequest) => fromNodeHeaders(request.headers)
  return {
    auth, database,
    async ready() { const migration = await getMigrations(auth.options); await migration.runMigrations(); database.exec('PRAGMA user_version=1;') },
    close() { database.close() },
    async revokeBusinessUser(id: string) {
      const subject = identity.db.get('SELECT subject FROM users WHERE id=?', id)?.subject
      if (typeof subject !== 'string') fail('not-found')
      const context = await auth.$context
      const users = await context.adapter.findMany<{ id: string }>({ model: 'user', where: [{ field: 'linuxdoSubject', value: subject }] })
      for (const user of users) await context.internalAdapter.deleteUserSessions(user.id)
    },
    async current(request: FastifyRequest) {
      const result = await auth.api.getSession({ headers: headers(request), query: { disableCookieCache: true, disableRefresh: true } })
      if (!result) return undefined
      return identity.resolve({ subject: result.user.linuxdoSubject, username: result.user.linuxdoUsername, name: result.user.name }, result.session.token)
    },
    async start(request: FastifyRequest) {
      if (!config.oauth) fail('configuration-required')
      const response = await auth.api.signInSocial({ headers: headers(request), asResponse: true,
        body: { provider: 'linuxdo', callbackURL: `${config.origin}/app`, errorCallbackURL: `${config.origin}/app?login=failed`, disableRedirect: true } })
      if (!response.ok) fail('oauth-failed')
      const body = await response.json() as { url: string }
      return { cookies: response.headers.getSetCookie(), url: provider ? provider.authorizationUrl(new URL(body.url).searchParams.get('state')!) : body.url }
    },
    callback(request: FastifyRequest) {
      const target = new URL(request.url, config.origin); target.pathname = '/api/auth/callback/linuxdo'
      return auth.handler(new Request(target, { headers: headers(request) }))
    },
    logout(request: FastifyRequest) { return auth.api.signOut({ headers: headers(request), asResponse: true }) }
  }
}
