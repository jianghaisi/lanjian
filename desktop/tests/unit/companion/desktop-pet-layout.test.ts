import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutDesktopPet } from '../../../src/main/modules/companion/application/desktop-pet-layout'
import type { DesktopPetPanel, DesktopPetRect } from '../../../src/contracts/companion/desktop-pet'
import { decodeDesktopPetLayout } from '../../../src/contracts/companion/desktop-pet'

function global(rect: DesktopPetRect, bounds: DesktopPetRect) { return { ...rect, x: rect.x + bounds.x, y: rect.y + bounds.y } }
function inside(rect: DesktopPetRect, outer: DesktopPetRect) {
  assert.ok(rect.x >= outer.x && rect.y >= outer.y && rect.x + rect.width <= outer.x + outer.width && rect.y + rect.height <= outer.y + outer.height, JSON.stringify({ rect, outer }))
}
test('side forms keep actual character geometry at three sizes, choose either side and never mutate home', () => {
  for (const scale of [.6, 1, 1.8]) for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1600, y: -200, width: 1600, height: 1000 }]) {
    const size = { width: Math.round(320 * Math.max(1, scale)), height: Math.round(460 * Math.max(1, scale)) }
    for (const edge of ['left', 'right']) {
      const home = { ...size, x: edge === 'left' ? area.x : area.x + area.width - size.width, y: area.y + area.height - size.height }
      const original = { ...home }, idle = layoutDesktopPet(home, scale, null, area)
      for (const kind of ['chat', 'care', 'settings'] as DesktopPetPanel[]) {
        const value = layoutDesktopPet(home, scale, kind, area), pet = global(value.layout.pet, value.bounds), panel = global(value.layout.panel!, value.bounds)
        assert.deepEqual(decodeDesktopPetLayout(value.layout), value.layout)
        assert.deepEqual(pet, global(idle.layout.pet, idle.bounds))
        assert.equal(value.layout.side, edge === 'left' ? 'right' : 'left')
        assert.ok(panel.x + panel.width <= pet.x - 16 || panel.x >= pet.x + pet.width + 16)
        inside(value.bounds, area); inside(pet, area); inside(panel, area)
        assert.deepEqual(home, original)
        assert.deepEqual(layoutDesktopPet(home, scale, null, area).bounds, original)
      }
    }
  }
})
test('layout projection rejects unknown kinds, mismatched closed panels and non-finite rectangles', () => {
  const rect = { x: 8, y: 8, width: 230, height: 272 }, valid = { pet: rect, panel: null, side: null, kind: null }
  assert.deepEqual(decodeDesktopPetLayout(valid), valid)
  for (const value of [null, [], {}, { ...valid, extra: true }, { ...valid, kind: 'browser' }, { ...valid, side: 'left' },
    { ...valid, pet: { ...rect, x: NaN } }, { ...valid, pet: { ...rect, width: 0 } }, { ...valid, pet: { ...rect, height: Infinity } },
    { ...valid, pet: { ...rect, x: -1 } }, { ...valid, kind: 'settings', panel: rect, side: 'top' }]) assert.throws(() => decodeDesktopPetLayout(value), /PET_LAYOUT_INVALID/)
})

test('short work areas fit both artwork axes uniformly before opening any panel', () => {
  for (const area of [{ x: 0, y: 0, width: 640, height: 400 }, { x: -800, y: -300, width: 800, height: 500 }]) {
    const home = { x: area.x + area.width - 576, y: area.y, width: 576, height: area.height }
    const idle = layoutDesktopPet(home, 1.8, null, area)
    inside(global(idle.layout.pet, idle.bounds), area)
    for (const kind of ['menu', 'settings', 'care', 'chat'] as DesktopPetPanel[]) {
      const value = layoutDesktopPet(home, 1.8, kind, area)
      assert.deepEqual(decodeDesktopPetLayout(value.layout), value.layout)
      assert.equal(value.layout.pet.width, idle.layout.pet.width)
      assert.equal(value.layout.pet.height, idle.layout.pet.height)
      assert.ok(Math.abs(value.layout.pet.width / 230 - (value.layout.pet.height - 32) / 240) < 1e-10)
      inside(value.bounds, area)
      inside(global(value.layout.pet, value.bounds), area)
      inside(global(value.layout.panel!, value.bounds), area)
    }
  }
})
test('a small display narrows the panel and makes temporary room without scaling the character', () => {
  const area = { x: -800, y: 0, width: 800, height: 600 }, home = { x: -620, y: 140, width: 320, height: 460 }
  const idle = layoutDesktopPet(home, 1, null, area), expanded = layoutDesktopPet(home, 1, 'settings', area)
  assert.equal(expanded.layout.pet.width, idle.layout.pet.width)
  assert.equal(expanded.layout.pet.height, idle.layout.pet.height)
  assert.ok(expanded.layout.panel!.width >= 280)
  inside(expanded.bounds, area)
  const pet = global(expanded.layout.pet, expanded.bounds), panel = global(expanded.layout.panel!, expanded.bounds)
  assert.ok(panel.x + panel.width <= pet.x - 16 || panel.x >= pet.x + pet.width + 16)
  assert.deepEqual(layoutDesktopPet(home, 1, null, area), idle)
})
