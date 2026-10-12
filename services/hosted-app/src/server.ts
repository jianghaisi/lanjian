import { configFromEnv } from './config.ts'
import { buildApp } from './http/app.ts'
import { registerStatic } from './http/static.ts'

async function main() {
  const config = configFromEnv()
  const { app, credits, jobs } = buildApp({ config })
  if (process.env.LANJIAN_WEB_DIR) await registerStatic(app, process.env.LANJIAN_WEB_DIR)
  credits.recoverAfterRestart()
  jobs.recoverAfterRestart()
  const shutdown = async () => { await app.close(); process.exitCode = 0 }
  process.once('SIGTERM', () => { void shutdown() })
  process.once('SIGINT', () => { void shutdown() })
  await app.listen({ host: config.host, port: config.port })
  process.stdout.write('Lanjian hosted service ready.\n')
}
void main().catch(() => { process.stderr.write('Hosted service startup failed. Check configuration and data permissions.\n'); process.exitCode = 1 })
