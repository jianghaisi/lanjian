import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolvePortablePython } from '../../../src/main/platform/processes/portable-python-runtime'

test('portable Python rebases a migrated venv home into the current runtime root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-portable-python-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const environment = join(root, 'gpt-sovits-audition', 'venv')
  const bundledHome = join(root, 'python', 'cpython-3.12.10-windows-x86_64-none')
  await mkdir(environment, { recursive: true })
  await mkdir(bundledHome, { recursive: true })
  await writeFile(join(environment, 'pyvenv.cfg'), 'home = E:\\moved\\python\\cpython-3.12.10-windows-x86_64-none\nversion_info = 3.12.10\n')
  await writeFile(join(bundledHome, 'python.exe'), '')

  const result = await resolvePortablePython(root, environment)
  assert.equal(result.python.toLowerCase(), (await realpath(join(bundledHome, 'python.exe'))).toLowerCase())
})

test('portable Python rejects an unrelated configured home instead of searching the machine', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-portable-python-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const environment = join(root, 'venv')
  await mkdir(environment, { recursive: true })
  await writeFile(join(environment, 'pyvenv.cfg'), 'home = C:\\Python312\nversion_info = 3.12.10\n')

  await assert.rejects(resolvePortablePython(root, environment), /BUNDLED_PYTHON_PATH/)
})

test('portable Python rejects a bundled-looking junction that escapes the runtime root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-portable-python-'))
  const external = await mkdtemp(join(tmpdir(), 'lanjian-external-python-'))
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(external, { recursive: true, force: true })]))
  const environment = join(root, 'venv')
  const linkedHome = join(root, 'python', 'cpython-3.12-windows-x86_64-none')
  await mkdir(environment, { recursive: true })
  await mkdir(join(root, 'python'), { recursive: true })
  await writeFile(join(external, 'python.exe'), '')
  await symlink(external, linkedHome, 'junction')
  await writeFile(join(environment, 'pyvenv.cfg'), `home = ${linkedHome}\nversion_info = 3.12.13\n`)

  await assert.rejects(resolvePortablePython(root, environment), /BUNDLED_PYTHON_PATH/)
})
