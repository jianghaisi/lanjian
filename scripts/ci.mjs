import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] ?? 'all'
const shard = process.argv[3]
if (!['install', 'check', 'all'].includes(mode) || process.argv.length > 4 ||
    (shard && !/^[1-4]\/4$/.test(shard))) {
  throw new Error('Usage: node scripts/ci.mjs [install|check|all] [1/4|2/4|3/4|4/4]')
}
const packages = ['packages/hosted-contracts', 'packages/writing-plugin-contracts', 'packages/writing-plugin-package', 'desktop', 'web', 'services/hosted-app', 'services/plugin-marketplace']
function npm(directory, ...args) {
  console.log(`\n[ci] ${directory}: npm ${args.join(' ')}`)
  // Directory and arguments come only from the fixed lists in this file.
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: resolve(root, directory), stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (mode !== 'check') {
  for (const directory of packages) {
    npm(directory, 'ci')
    if (directory.startsWith('packages/')) npm(directory, 'run', 'build')
  }
}
if (mode !== 'install') {
  // Desktop integration tests import this service's generated JS/types.
  npm('services/plugin-marketplace', 'run', 'build')
  npm('packages/hosted-contracts', 'test')
  npm('packages/writing-plugin-contracts', 'test')
  npm('packages/writing-plugin-package', 'run', 'build')
  npm('desktop', 'run', 'typecheck')
  npm('desktop', 'run', 'check:architecture')
  // All four native Node shards cover the complete sorted file list. One file
  // per Windows runner avoids disk contention and cold DPAPI process timeouts.
  npm('desktop', 'run', 'test:desktop', '--', '--test-concurrency=1', ...(shard ? [`--test-shard=${shard}`] : []))
  for (const directory of ['web', 'services/hosted-app', 'services/plugin-marketplace']) {
    npm(directory, 'run', 'typecheck')
    npm(directory, 'test')
    npm(directory, 'run', 'build')
  }
  npm('desktop', 'run', 'desktop:build')
}
