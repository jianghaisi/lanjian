import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePluginManifest, validatePluginPath } from '../dist/index.js'
const schema = { type: 'object', additionalProperties: false, properties: {} }
const manifest = () => ({ apiVersion: 1, id: 'author.rhythm', name: '节奏分析', version: '1.0.0', description: '检查节奏', runtime: 'quickjs-js', entry: 'main.js', capabilities: ['book.read'], tools: [{ id: 'rhythm', description: '分析', effect: 'read', capabilities: ['book.read'], inputSchema: schema, outputSchema: schema }], assets: ['assets/参考.txt'] })
test('manifest is a detached validated distribution contract with no host authority', () => {
  const value = manifest(), result = validatePluginManifest(value)
  assert.deepEqual(result, value); value.capabilities.length = 0; assert.deepEqual(result.capabilities, ['book.read'])
  assert.equal(validatePluginPath('assets/参考.txt'), 'assets/参考.txt')
})
test('manifest rejects incompatible, privileged, duplicate and widened tool definitions', () => {
  for (const change of [{ apiVersion: 2 }, { id: 'builtin.core' }, { runtime: 'node' }, { entry: '../main.js' }, { version: '01.0.0' }, { install: 'npm install' }, { assets: ['MAIN.js'] }, { capabilities: [] }]) assert.throws(() => validatePluginManifest({ ...manifest(), ...change }))
  const value = manifest(); value.tools.push(value.tools[0]); assert.throws(() => validatePluginManifest(value))
})
test('portable paths reject normalization, devices, ADS, UNC, traversal and ambiguous names', () => {
  for (const path of ['/abs', '../a', 'a/../b', 'a\\b', '//server/a', 'C:/a', 'main.js:payload', 'a//b', 'NUL.txt', 'com1', 'a/CON', 'a.', 'a ', 'a\u0000b', 'a/e\u0301.txt']) assert.throws(() => validatePluginPath(path), path)
})
