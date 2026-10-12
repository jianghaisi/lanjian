import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join, resolve } from 'node:path'
import { mainOutputDirectory } from '../../src/main/platform/processes/main-output-directory'

for (const root of [resolve('临时应用/out'), resolve('临时应用/resources/app.asar/out')]) {
  test(`main resources keep the same paths after code splitting: ${root}`, () => {
    const expected = join(root, 'main')
    for (const emittedDirectory of [expected, join(expected, 'chunks')]) {
      const main = mainOutputDirectory(emittedDirectory)
      assert.equal(main, expected)
      for (const preload of ['index.cjs', 'desktop-pet.cjs']) {
        assert.equal(join(main, '../preload', preload), join(root, 'preload', preload))
      }
      for (const page of ['index.html', 'pet.html']) {
        assert.equal(join(main, '../renderer', page), join(root, 'renderer', page))
      }
      for (const worker of ['local-models/text-worker.py', 'companion-voice/worker.py']) {
        assert.equal(join(main, worker), join(expected, worker))
      }
      // Code splitting must not silently relocate the existing local model store.
      assert.equal(join(main, '../../../../.local/companion-voice'), join(expected, '../../../../.local/companion-voice'))
    }
  })
}
