import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = (await readdir(resolve(packageRoot, 'tests'), { recursive: true }))
  .filter(file => /\.test\.(?:ts|mjs)$/.test(file) && /^(unit|integration)[\\/]/.test(file))
  .map(file => 'tests/' + file.replaceAll('\\', '/'))
  .sort()
if (!files.length) throw new Error('No desktop tests were discovered')
if (process.argv.includes('--list')) {
  console.log(files.join('\n'))
} else {
  // Bound real SQLite/file test contention on high-core Windows hosts.
  const options = process.argv.slice(2)
  const concurrency = options.some(option => option.startsWith('--test-concurrency')) ? [] : ['--test-concurrency=4']
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...concurrency, ...options, ...files], {
    cwd: packageRoot, stdio: 'inherit', windowsHide: true
  })
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
