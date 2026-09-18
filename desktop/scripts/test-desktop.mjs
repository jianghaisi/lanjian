import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = (await readdir(resolve(packageRoot, 'tests'), { recursive: true }))
  .filter(file => file.endsWith('.test.ts') && /^(unit|integration)[\\/]/.test(file))
  .map(file => 'tests/' + file.replaceAll('\\', '/'))
  .sort()
if (!files.length) throw new Error('No desktop tests were discovered')
if (process.argv.includes('--list')) {
  console.log(files.join('\n'))
} else {
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], {
    cwd: packageRoot, stdio: 'inherit', windowsHide: true
  })
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
