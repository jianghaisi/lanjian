import test from 'node:test'
import { petFrameDensity } from '../../../src/renderer/features/companion/services/pet-sequence-registration'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import registration from '../../../src/renderer/assets/visuals/pet-sequences/registration.json'
import { isolatePetFrame } from '../../../src/renderer/features/companion/services/pet-frame-isolation'

function fixture(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const point = (x: number, y: number, alpha = 255) => pixels.set([80, 50, 20, alpha], (y * width + x) * 4)
  const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3]
  return { pixels, point, alpha }
}

test('a frame excludes neighboring hair fragments but retains the connected hand, prop and translucent edge', () => {
  const { pixels, point, alpha } = fixture(32, 24)
  for (let y = 4; y < 22; y++) for (let x = 11; x < 21; x++) point(x, y)
  for (let x = 20; x < 29; x++) point(x, 10) // Hand holding a prop.
  point(29, 9); point(29, 11)
  point(10, 8, 8); point(9, 8, 3) // Soft two-pixel antialiasing, not an opaque cutout.
  for (let y = 6; y < 16; y++) { point(0, y); point(1, y, 12) }
  point(22, 0) // The previous atlas row's boot.
  const before = pixels.slice()
  assert.ok(isolatePetFrame(pixels, 32, [0, 0, 32, 24]) > 0)
  assert.equal(alpha(0, 10), 0); assert.equal(alpha(1, 10), 0); assert.equal(alpha(22, 0), 0)
  assert.equal(alpha(29, 9), 255); assert.equal(alpha(29, 11), 255)
  assert.equal(alpha(10, 8), 8); assert.equal(alpha(9, 8), 3)
  assert.deepEqual(pixels.slice((8 * 32 + 10) * 4, (8 * 32 + 21) * 4), before.slice((8 * 32 + 10) * 4, (8 * 32 + 21) * 4))
})

test('irregular atlas rectangles stay independent and repeated cleanup is idempotent', () => {
  const { pixels, point, alpha } = fixture(41, 19)
  for (let y = 2; y < 18; y++) for (let x = 10; x < 18; x++) point(x, y)
  for (let y = 5; y < 16; y++) for (let x = 31; x < 40; x++) point(x, y)
  point(27, 6); point(21, 4)
  const before = pixels.slice()
  isolatePetFrame(pixels, 41, [25, 3, 16, 16])
  for (let y = 0; y < 19; y++) for (let x = 0; x < 25; x++) assert.equal(alpha(x, y), before[(y * 41 + x) * 4 + 3])
  assert.equal(alpha(27, 6), 0); assert.equal(alpha(39, 10), 255)
  const once = pixels.slice(); isolatePetFrame(pixels, 41, [25, 3, 16, 16])
  assert.deepEqual(pixels, once)
})

test('an empty cell fails explicitly instead of producing an invisible successful pet', () => {
  assert.throws(() => isolatePetFrame(new Uint8ClampedArray(8 * 8 * 4), 8, [0, 0, 8, 8]), /PET_FRAME_EMPTY/)
})

test('all shipped frames keep their opaque character while excluding atlas debris; planted soles no longer slide', () => {
  // Reuse the PNG reader already bundled with the native test runner. No new
  // runtime/image-processing dependency and no writing or editing asset files.
  const { PNG } = createRequire(import.meta.url)(fileURLToPath(new URL('../../../node_modules/playwright-core/lib/utilsBundle.js', import.meta.url))) as {
    PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Uint8Array } } }
  }
  for (const [name, sheet] of Object.entries(registration)) {
    const atlasWidth = sheet.size[0]!, pixels = new Uint8ClampedArray(atlasWidth * sheet.size[1]! * 4)
    const pages = 'pages' in sheet ? sheet.pages : [{ file: `${name}.png`, origin: [0, 0] }]
    for (const page of pages) {
      const source = readFileSync(new URL(`../../../src/renderer/assets/visuals/pet-sequences/${page.file}`, import.meta.url))
      const decoded = PNG.sync.read(source)
      for (let row = 0; row < decoded.height; row++) {
        pixels.set(decoded.data.subarray(row * decoded.width * 4, (row + 1) * decoded.width * 4), ((page.origin[1]! + row) * atlasWidth + page.origin[0]!) * 4)
      }
    }
    const offsets: number[] = []
    for (const [index, frame] of sheet.frames.entries()) {
      const [x, y, width, height] = frame.rect as [number, number, number, number]
      let before = 0, after = 0
      for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) if (pixels[(yy * atlasWidth + xx) * 4 + 3]! >= 100) before++
      isolatePetFrame(pixels, atlasWidth, frame.rect)
      for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) if (pixels[(yy * atlasWidth + xx) * 4 + 3]! >= 100) after++
      assert.ok(after / before > .99, `${name}: opaque body/prop was lost`)
      // Independently sample just the very bottom 3px, not the generator's 6px
      // band. The old robe-biased anchors fail this with 25–58px of drift.
      const [anchor, floor] = frame.anchor as [number, number], sole: number[] = []
      for (let xx = Math.ceil(width * .3); xx < width * .75; xx++) {
        for (let yy = Math.max(0, floor - 3); yy < floor; yy++) if (pixels[((y + yy) * atlasWidth + x + xx) * 4 + 3]! >= 100) { sole.push(xx); break }
      }
      assert.ok(sole.length)
      offsets.push(((Math.min(...sole) + Math.max(...sole)) / 2 - anchor) / petFrameDensity(sheet, index))
    }
    if (!['sleeping', 'drag', 'land'].includes(name)) assert.ok(Math.max(...offsets) - Math.min(...offsets) < 6, `${name}: planted soles slide across registered frames`)
  }
})
