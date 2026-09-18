import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isAllowedAppNavigation, isAllowedExternalUrl } from '../../src/main/bootstrap/window-security'

test('allows only credential-free HTTP(S) links to leave the application', () => {
  assert.equal(isAllowedExternalUrl('https://example.com/source?q=1'), true)
  assert.equal(isAllowedExternalUrl('http://127.0.0.1:3000/help'), true)
  for (const value of [
    'file:///C:/Users/author/private.txt',
    'shell:RecycleBinFolder',
    'javascript:alert(1)',
    'https://token@example.com/source',
    'not a url'
  ]) assert.equal(isAllowedExternalUrl(value), false, value)
})

test('keeps packaged navigation on the exact renderer file and development navigation in one origin', () => {
  const packaged = 'file:///C:/app/out/renderer/index.html?opening=1'
  assert.equal(isAllowedAppNavigation(packaged, 'file:///C:/app/out/renderer/index.html#settings'), true)
  assert.equal(isAllowedAppNavigation(packaged, 'file:///C:/Users/author/private.txt'), false)
  assert.equal(isAllowedAppNavigation(packaged, 'https://example.com'), false)
  assert.equal(isAllowedAppNavigation('http://localhost:5173/', 'http://localhost:5173/settings'), true)
  assert.equal(isAllowedAppNavigation('http://localhost:5173/', 'http://127.0.0.1:5173/settings'), false)
  assert.equal(isAllowedAppNavigation('http://localhost:5173/', 'http://name:secret@localhost:5173/settings'), false)
})

test('desktop composition keeps sandbox isolation and wires every navigation guard', () => {
  const source = readFileSync(new URL('../../src/main/bootstrap/create-main-window.ts', import.meta.url), 'utf8').replace(/\s+/g, ' ')
  assert.equal((source.match(/new BrowserWindow\(/g) || []).length, 1)
  assert.match(source, /contextIsolation: true, nodeIntegration: false, sandbox: true/)
  assert.match(source, /setWindowOpenHandler\(\(\{ url \}\) => \{ if \(isAllowedExternalUrl\(url\)\)/)
  assert.match(source, /setPermissionRequestHandler\(\(_webContents, _permission, callback\) => callback\(false\)\)/)
  assert.match(source, /webContents\.on\('will-navigate', guardNavigation\)/)
  assert.match(source, /webContents\.on\('will-redirect', guardNavigation\)/)
})

test('preload exposes a typed facade without giving renderer raw IPC access', () => {
  const source = readFileSync(new URL('../../src/preload/index.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/contextBridge\.exposeInMainWorld\(/g) || []).length, 1)
  assert.match(source, /contextBridge\.exposeInMainWorld\('novelDesktop', desktopApi\)/)
  assert.equal((source.match(/ipcRenderer\.invoke\(/g) || []).length, 1)
  assert.deepEqual([...source.matchAll(/ipcRenderer\.send\('([^']+)'/g)].map((match) => match[1]).sort(), [
    'app:close-ready', 'app:show-selection-ai-menu'
  ])
  assert.deepEqual([...source.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((match) => match[1]).sort(), [
    'app:before-close', 'app:selection-ai-action', 'app:window-shown'
  ])
  assert.doesNotMatch(source, /exposeInMainWorld\([^\n]+ipcRenderer/)
})
