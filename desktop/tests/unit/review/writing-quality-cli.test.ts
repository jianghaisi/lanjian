import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseOfflineWritingQualityArgs, runOfflineWritingQualityCli } from '../../../scripts/evaluate-writing-quality'

test('CLI accepts only an explicit offline composition', () => {
  assert.throws(() => parseOfflineWritingQualityArgs(['--output-root', '.', '--run-live']), /Unsupported argument/)
  assert.throws(() => parseOfflineWritingQualityArgs(['--output-root', '.', '--model', 'x']), /Unsupported argument/)
  assert.throws(() => parseOfflineWritingQualityArgs(['--output-root', '.']), /requires --offline/)
  assert.throws(() => parseOfflineWritingQualityArgs(['--offline']), /output-root/)
  assert.equal(parseOfflineWritingQualityArgs(['--offline', '--output-root', '.', '--run-id', 'cli-run', '--seed', '31']).runId, 'cli-run')
})

test('CLI produces a protocol-only offline run', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-quality-cli-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => { throw new Error('network forbidden') }) as typeof fetch
  context.after(() => { globalThis.fetch = originalFetch })
  const summary = await runOfflineWritingQualityCli(['--offline', '--output-root', root, '--run-id', 'cli-run', '--seed', '31'])
  assert.equal(summary.status, 'protocol-complete')
  assert.equal(summary.successfulSlots, 9)
  assert.equal(summary.packetCount, 9)
  assert.deepEqual(summary.judgmentCoverage, { completed: 0, required: 9, ratio: 0 })
})
