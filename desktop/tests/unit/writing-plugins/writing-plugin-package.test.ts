import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { readPluginPackage } from '../../../src/main/modules/writing-plugins/adapters/package-reader'
import { codePluginLimits } from '@lanjian/writing-plugin-contracts'
const schema = { type: 'object', additionalProperties: false, properties: {} }
const manifest = { apiVersion: 1, id: 'author.rhythm', name: '节奏分析', version: '1.0.0', description: '分析节奏', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [{ id: 'rhythm', description: '分析', effect: 'derive', capabilities: [], inputSchema: schema, outputSchema: schema }], assets: ['assets/reference.txt'] }
async function archive(change: (zip: JSZip) => void = () => {}, compression: 'STORE' | 'DEFLATE' = 'DEFLATE') {
  const zip = new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', 'export function execute(){return {}}').file('assets/reference.txt', '只读参考')
  change(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression, platform: 'UNIX' })
}
test('preview validates ZIP/manifest, preserves entry bytes and never executes code', async () => {
  for (const compression of ['STORE', 'DEFLATE'] as const) {
    const bytes = await archive(zip => zip.file('main.js', 'throw Error("must not run during preview")'), compression)
    const result = await readPluginPackage(bytes)
    assert.deepEqual(result.manifest, manifest); assert.equal(result.digest.length, 64)
    assert.equal(result.files.get('assets/reference.txt')?.toString(), '只读参考')
    assert.equal(result.files.size, 3)
  }
})
test('unsafe paths, case collisions, file/directory collisions and symlink entries fail', async () => {
  for (const name of ['../outside.txt', 'C:/secret.txt', 'a\\bad', 'a.txt:stream', '/absolute', 'NUL.txt', 'MAIN.JS', 'main.js/child']) {
    await assert.rejects(readPluginPackage(await archive(zip => zip.file(name, 'bad', { createFolders: false }))), { code: 'VALIDATION_ERROR' }, name)
  }
  await assert.rejects(readPluginPackage(await archive(zip => zip.file('link', 'target', { unixPermissions: 0o120777 }))))
})
test('manifest, entry, declared assets and UTF-8 are mandatory and bounded', async () => {
  for (const path of ['lanjian-plugin.json', 'main.js', 'assets/reference.txt']) await assert.rejects(readPluginPackage(await archive(zip => zip.remove(path))))
  await assert.rejects(readPluginPackage(await archive(zip => zip.file('main.js', Buffer.from([0xff])))))
  await assert.rejects(readPluginPackage(await archive(zip => zip.file('main.js', 'x'.repeat(codePluginLimits.entryBytes + 1)))))
  await assert.rejects(readPluginPackage(await archive(zip => zip.file('lanjian-plugin.json', JSON.stringify({ ...manifest, runtime: 'node' })))))
})
test('entry count and compressed/uncompressed bomb budgets fail before extraction', async () => {
  await assert.rejects(readPluginPackage(Buffer.alloc(codePluginLimits.zipBytes + 1)))
  await assert.rejects(readPluginPackage(await archive(zip => zip.file('bomb.txt', 'x'.repeat(codePluginLimits.unpackedBytes + 1)))))
  await assert.rejects(readPluginPackage(await archive(zip => { for (let i = 0; i < 130; i++) zip.file(`f${i}`, '') })))
})
test('duplicate raw entries and different local/central names cannot be silently overwritten', async () => {
  const bytes = await archive(zip => zip.file('data-aa.txt', 'A').file('data-bb.txt', 'B'), 'STORE')
  const duplicate = Buffer.from(bytes)
  let at = 0
  while ((at = duplicate.indexOf('data-bb.txt', at)) >= 0) { duplicate.write('data-aa.txt', at); at += 11 }
  await assert.rejects(readPluginPackage(duplicate))
  const mismatch = Buffer.from(bytes), local = mismatch.indexOf('data-aa.txt')
  mismatch.write('data-cc.txt', local)
  await assert.rejects(readPluginPackage(mismatch))
})
test('CRC corruption and lied uncompressed size fail; public error hides archive paths', async () => {
  const bytes = await archive(zip => zip.file('secret-token.txt', 'abcdef'), 'STORE')
  const corrupt = Buffer.from(bytes), body = corrupt.indexOf('abcdef')
  corrupt[body] = 0
  await assert.rejects(readPluginPackage(corrupt), error => error instanceof Error && !error.message.includes('secret-token'))
  const bomb = await archive(zip => zip.file('small.txt', 'a'.repeat(10000)))
  const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 1)
  bomb.writeUInt32LE(1, central + 24)
  await assert.rejects(readPluginPackage(bomb))
})
