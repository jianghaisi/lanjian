import { serviceConfig } from './config.ts'
import { oidcIdentity } from './adapters/oidc-auth.ts'
import { createMarketApp } from './app.ts'
const config = serviceConfig(process.env)
const { app } = await createMarketApp(config.root, oidcIdentity(config.issuer, config.audience, config.jwks))
await app.listen({ port: config.port, host: config.host })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })
console.log(`Plugin marketplace listening on ${config.host}:${config.port}`)
