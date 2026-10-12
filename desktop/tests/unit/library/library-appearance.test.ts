import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileStyle, parse } from '@vue/compiler-sfc'
import postcss from 'postcss'

const appearanceUrl = new URL('../../../src/renderer/features/library/composables/library-appearance.ts', import.meta.url)
const libraryUrl = new URL('../../../src/renderer/features/library/components/ProjectLibrary.vue', import.meta.url)
const characterUrl = new URL('../../../src/renderer/features/companion/components/InteractiveArchiveCharacter.vue', import.meta.url)
const settingsUrl = new URL('../../../src/renderer/features/library/components/LibraryAppearanceSettings.vue', import.meta.url)
const galleryUrl = new URL('../../../src/renderer/features/library/components/LibraryWorksGallery.vue', import.meta.url)
const shellUrl = new URL('../../../src/renderer/app/AppShell.vue', import.meta.url)
const idleMotionUrl = new URL('../../../public/live2d/lanjian-rig/lanjian-rig.idle.motion3.json', import.meta.url)
const nodMotionUrl = new URL('../../../public/live2d/lanjian-rig/lanjian-rig.nod.motion3.json', import.meta.url)

test('library artwork choices persist independently from project data', async () => {
  const source = await readFile(appearanceUrl, 'utf8')
  assert.match(source, /lanjian-library-appearance-v4/)
  assert.match(source, /LEGACY_LIBRARY_APPEARANCE_STORAGE_KEYS/)
  assert.match(source, /background: 'industrial'/)
  assert.match(source, /scene: 'satellite'/)
  assert.match(source, /storage\.setItem/)
  assert.match(source, /recent-red-moon/)
  assert.match(source, /archive-observatory/)
  assert.match(source, /scale: finite\(character\.scale, defaultLibraryCharacterPlacement\.scale, \.7, 2\)/)
  assert.match(source, /scale: 1\.24, inlineOffset: 0, blockOffset: 18/)
  assert.match(source, /inlineOffset: finite/)
  assert.match(source, /blockOffset: finite/)
})

test('library uses the shared Live2D model, a selectable lower scene, and a useful local clock', async () => {
  const [library, character, settings] = await Promise.all([readFile(libraryUrl, 'utf8'), readFile(characterUrl, 'utf8'), readFile(settingsUrl, 'utf8')])
  assert.match(library, /archive-companion-background/)
  assert.match(character, /Live2DCompanion/)
  assert.match(character, /:blink="blink"/)
  assert.match(character, /:action="action"/)
  assert.doesNotMatch(character, /character-kanban|character-layer|hair-layer|gesture-wave|Shake/)
  assert.match(library, /class="heading-clock"/)
  assert.match(library, /clockTime/)
  assert.match(library, /clockDate/)
  assert.match(library, /clockWeekday/)
  assert.match(library, /second: '2-digit'/)
  assert.match(library, /1_000 - \(Date\.now\(\) % 1_000\)/)
  assert.match(library, /font-variant-numeric:tabular-nums/)
  assert.match(library, /grid-template-columns:minmax\(5\.75rem,1fr\) auto/)
  assert.match(library, /\.heading-clock>span\{grid-column:2;grid-row:1\/3/)
  assert.match(library, /\.heading-clock small\{grid-column:1;grid-row:2/)
  assert.doesNotMatch(library, /easter-egg-0803-transparent\.png|heading-index/)
  assert.match(library, /--character-scale/)
  assert.match(library, /--character-inline-offset/)
  assert.match(library, /--character-block-offset/)
  assert.match(library, /:scene-artwork="sceneArtwork"/)
  assert.match(settings, /library-background-/)
  assert.match(settings, /library-scene-/)
  assert.match(settings, /library-character-scale/)
  assert.match(settings, /library-character-inline/)
  assert.match(settings, /library-character-block/)
})

test('library theme, card contrast, dialogue and assistant boundaries are explicit', async () => {
  const [library, gallery, character, settings, shell] = await Promise.all([
    readFile(libraryUrl, 'utf8'),
    readFile(galleryUrl, 'utf8'),
    readFile(characterUrl, 'utf8'),
    readFile(settingsUrl, 'utf8'),
    readFile(shellUrl, 'utf8')
  ])
  assert.match(library, /--library-paper:var\(--canvas/)
  assert.match(library, /--library-ink:var\(--ink,/)
  assert.match(library, /data-theme="moye"/)
  assert.match(gallery, /\.work-card:hover \.work-card-tags i/)
  assert.match(gallery, /\.work-card-main:focus-visible \.work-card-tags i/)
  assert.match(gallery, /color:var\(--library-ink[^;]*!important/)
  assert.match(character, /<Teleport to="body">/)
  assert.match(character, /data-anchor="stage-safe"/)
  assert.match(character, /<CompanionDialoguePanel/)
  const dialoguePanel = await readFile(new URL('../../../src/renderer/features/companion/components/CompanionDialoguePanel.vue', import.meta.url), 'utf8')
  assert.match(dialoguePanel, /position:fixed/)
  assert.doesNotMatch(library, /library-dialogue-lane|dialogueReserved/)
  assert.doesNotMatch(library, /library-(?:open-)?assistant|智能助笔|v-assist-field/)
  assert.doesNotMatch(settings, /v-assist-field/)
  assert.match(shell, /<GlobalAssistantHost[^>]*v-if="desktop && current"/)
  assert.match(shell, /<GlobalAssistantHost[^>]*:visible="!groupChatOpen && !inspirationOpen"/)
  assert.match(shell, /const assistantPresented = assistantOpen/)
  assert.match(shell, /v-if="current && assistantAvailable && assistantPresented"[^>]*v-show="!groupChatOpen && !inspirationOpen"[^>]*class="assistant-resizer"/)
})

test('compiled dark theme rules target library artwork, never the document root', async () => {
  for (const [url, target] of [[libraryUrl, '.project-library'], [galleryUrl, '.works-watermark']] as const) {
    const { descriptor } = parse(await readFile(url, 'utf8'))
    const rules: string[] = []
    for (const style of descriptor.styles) {
      const result = compileStyle({ source: style.content, filename: url.pathname, id: 'data-v-library-test', scoped: style.scoped })
      assert.deepEqual(result.errors, [])
      postcss.parse(result.code).walkRules(rule => {
        if (rule.selector.includes('data-theme="moye"')) rules.push(rule.selector)
      })
    }
    assert.deepEqual(rules, [`:root[data-theme="moye"] ${target}`])
  }
})

test('shared Live2D renderer keeps cached textures alive across the library and detached pet hosts', async () => {
  const source = await readFile(new URL('../../../src/renderer/features/companion/components/Live2DCompanion.vue', import.meta.url), 'utf8')
  assert.match(source, /publicAsset\('live2d\/lanjian-rig\/lanjian-rig\.model3\.json'\)/)
  assert.match(source, /publicAsset\('vendor\/live2d\/live2dcubismcore\.min\.js'\)/)
  assert.match(source, /Math\.max\(2, window\.devicePixelRatio/)
  assert.match(source, /texture: false, baseTexture: false/)
})

test('library Live2D idle and click response do not drive the distorted head angle parameters', async () => {
  const [character, idle, nod] = await Promise.all([readFile(characterUrl, 'utf8'), readFile(idleMotionUrl, 'utf8'), readFile(nodMotionUrl, 'utf8')])
  assert.match(character, /character-acknowledge/)
  assert.match(character, /:intensity="0"/)
  assert.doesNotMatch(idle, /ParamAngle|ParamBodyAngle|ParamEye/)
  assert.doesNotMatch(nod, /ParamAngle|ParamBodyAngle|ParamEye|ParamMouth/)
  assert.match(nod, /ParamBreath/)
})
