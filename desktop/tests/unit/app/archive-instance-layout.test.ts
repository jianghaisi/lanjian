import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFile } from 'node:fs/promises'
import { Object3D } from 'three'
import { createArchiveCells, updateArchiveMatrices } from '../../../src/renderer/app/components/boot/archive-instance-layout'
import { archiveOpen, archiveWave, ease, progress } from '../../../src/renderer/app/components/boot/cinematic-timeline'

// Independent reference retains the original scene's Object3D translation order.
function referenceArchiveMatrices(buffers: Float32Array[], time: number, waveTime = time) {
  const dummy = new Object3D()
  let index = 0
  for (let lane = -8; lane <= 8; lane++) for (let row = -130; row <= 130; row++) {
    if (lane === 0 && row === 0) continue
    const wave = archiveWave(row, lane, waveTime), open = archiveOpen(row, lane, time)
    const shoulder = .8 * Math.exp(-(((Math.abs(row) - 6) / 5) ** 2)) * Math.exp(-Math.abs(lane) * .8) * ease(progress(time, 19.8, 21.5)) * (1 - ease(progress(time, 22.5, 25)))
    const spread = .08 * ease(progress(time, 21, 24)) * Math.exp(-Math.abs(row) * .13) * Math.exp(-Math.abs(lane))
    dummy.scale.setScalar(.85)
    dummy.position.set(lane * 7.2, 3.4 * .85 / 2 + (wave + shoulder) * .85 - (1 - open) * 5, row * (.92 + spread))
    dummy.rotation.set(-.025 * wave, 0, 0)
    const save = (part: number) => { dummy.updateMatrix(); dummy.matrix.toArray(buffers[part]!, index * 16) }
    save(0)
    dummy.translateY((3.4 / 2 - .015) * .85); save(1)
    dummy.translateY((-3.4 / 2 + .015) * .85); dummy.translateX((-7.2 / 2 + .09) * .85); dummy.translateZ(.092 * .85); save(2)
    dummy.translateX(.15 * .85); dummy.translateY((3.4 / 2 - .22) * .85); dummy.translateZ(.055 * .85); save(3)
    index++
  }
}

test('buffer transforms preserve all four parts and guard cells throughout unfolding, wave and extraction', () => {
  const cells = createArchiveCells()
  assert.equal(cells.length, 4436)
  assert.equal(cells.some(c => c.lane === 0 && c.row === 0), false)
  const actual = Array.from({length: 4}, () => new Float32Array(cells.length * 16))
  const expected = actual.map(b => new Float32Array(b.length))
  for (const [time, waveTime] of [[12,12],[12.6,12.6],[13.8,13.8],[15.3,15.3],[18.2,18.2],[19.9999,14.2],[19.9999,19.8],[21.5,21.5],[23,23],[25,25],[12,12]]) {
    updateArchiveMatrices(cells, actual, time!, waveTime!)
    referenceArchiveMatrices(expected, time!, waveTime!)
    for (let part = 0; part < 4; part++) for (let i = 0; i < actual[part]!.length; i++) {
      assert.ok(Math.abs(actual[part]![i]! - expected[part]![i]!) < .00001, `time=${time}, part=${part}, element=${i}`)
    }
  }
})

test('optional paired CPU benchmark (not a GPU or presentation measurement)', { skip: !process.env.ARCHIVE_MATRIX_BENCHMARK }, async () => {
  const cells = createArchiveCells(), buffers = Array.from({length:4}, () => new Float32Array(cells.length * 16))
  const oldSamples: number[] = [], newSamples: number[] = []
  // Alternate order so neither implementation always receives the warmer CPU.
  for (let i = -20; i < 120; i++) {
    const t = 12 + ((i + 20) % 120) / 120 * 13
    const old = () => { const start = performance.now(); referenceArchiveMatrices(buffers, t); if (i >= 0) oldSamples.push(performance.now() - start) }
    const current = () => { const start = performance.now(); updateArchiveMatrices(cells, buffers, t); if (i >= 0) newSamples.push(performance.now() - start) }
    if (i % 2) { old(); current() } else { current(); old() }
  }
  const stats = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return { median: sorted[60], p95: sorted[114], max: sorted.at(-1), samples: values } }
  await writeFile(process.env.ARCHIVE_MATRIX_BENCHMARK!, JSON.stringify({ cells: cells.length, old: stats(oldSamples), current: stats(newSamples) }, null, 2))
})
