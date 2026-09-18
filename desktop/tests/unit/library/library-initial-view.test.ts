import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { shouldApplyProjectLibraryRefresh } from '../../../src/renderer/features/library/services/project-library-refresh'

const libraryUrl = new URL('../../../src/renderer/features/library/components/ProjectLibrary.vue', import.meta.url)

test('project library keeps the continue hero until the author explicitly opens all works', async () => {
  const source = await readFile(libraryUrl, 'utf8')
  assert.match(source, /const allWorksExpanded = ref\(false\)/)
  assert.doesNotMatch(source, /projectCount > 1|initialLibraryViewResolved|libraryViewManuallyChosen/)
  assert.equal(source.match(/allWorksExpanded\.value = true/g)?.length, 1)
  assert.match(source, /async function showAllWorks\(\)[\s\S]*allWorksExpanded\.value = true/)
  assert.match(source, /async function returnToOverview\(\)[\s\S]*allWorksExpanded\.value = false/)
})

test('app shell marks the first successful authoritative project read separately from loading completion', async () => {
  const source = (await Promise.all(['app/AppShell.vue', 'app/use-workspace-controller.js', 'app/composables/create-boot-actions.js', 'features/library/composables/create-workspace-state.js', 'features/library/composables/create-projects-actions.js'].map(path => readFile(new URL('../../../src/renderer/' + path, import.meta.url), 'utf8')))).join('\n')
  assert.match(source, /const projectsLoaded = ref\(false\)/)
  assert.match(source, /projects\.value = result\.projects[\s\S]*projectsLoaded\.value = true/)
  assert.match(source, /:loaded="projectsLoaded"/)
  assert.match(source, /shouldReconcileLibrary[\s\S]*refreshProjects\(\)\.catch/)
  assert.match(source, /if \(\s*!shouldApplyProjectLibraryRefresh\(\{[\s\S]*requestGeneration[\s\S]*currentGeneration: (?:ports\.)?projectLibraryRefreshGeneration/)
  assert.equal(source.match(/refreshProjects\(\{ allowRemoval: true \}\)/g)?.length, 2)
})

test('passive library refresh cannot replace a loaded shelf with a smaller late snapshot', () => {
  assert.equal(shouldApplyProjectLibraryRefresh({ requestGeneration: 3, currentGeneration: 3, loaded: true, currentCount: 3, nextCount: 1 }), false)
  assert.equal(shouldApplyProjectLibraryRefresh({ requestGeneration: 2, currentGeneration: 3, loaded: true, currentCount: 1, nextCount: 3 }), false)
  assert.equal(shouldApplyProjectLibraryRefresh({ requestGeneration: 3, currentGeneration: 3, loaded: true, currentCount: 1, nextCount: 3 }), true)
  assert.equal(shouldApplyProjectLibraryRefresh({ requestGeneration: 1, currentGeneration: 1, loaded: false, currentCount: 0, nextCount: 1 }), true)
})

test('an explicit shelf removal may reduce the visible project count', () => {
  assert.equal(shouldApplyProjectLibraryRefresh({ requestGeneration: 4, currentGeneration: 4, loaded: true, currentCount: 3, nextCount: 2, allowRemoval: true }), true)
})
