/** Keep the complete character, including connected props, and its soft edge.
 * Atlas cells are not necessarily separated by empty rectangular gutters.
 * Runs once per loaded sheet, never per animation tick; source files are intact.
 */
export function isolatePetFrame(data: Uint8ClampedArray, sheetWidth: number, rect: readonly number[]) {
  const [left, top, width, height] = rect as readonly [number, number, number, number]
  const area = width * height, labels = new Int32Array(area), queue = new Int32Array(area)
  const offset = (pixel: number) => ((top + Math.floor(pixel / width)) * sheetWidth + left + pixel % width) * 4
  let label = 0, largest = 0, largestSize = 0
  for (let pixel = 0; pixel < area; pixel++) {
    if (labels[pixel] || data[offset(pixel) + 3]! < 16) continue
    label++; let head = 0, tail = 1
    queue[0] = pixel; labels[pixel] = label
    while (head < tail) {
      const p = queue[head++]!, x = p % width, y = Math.floor(p / width)
      // Diagonal hair and fingers belong to the same silhouette too.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue
        const next = p + dy * width + dx
        if (labels[next] || data[offset(next) + 3]! < 16) continue
        labels[next] = label; queue[tail++] = next
      }
    }
    if (tail > largestSize) { largest = label; largestSize = tail }
  }
  if (!largestSize) throw new Error('PET_FRAME_EMPTY')
  const keep = new Uint8Array(area)
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      if (labels[y * width + x] !== largest) { x++; continue }
      const start = Math.max(0, x - 2)
      while (x < width && labels[y * width + x] === largest) x++
      const end = Math.min(width, x + 2)
      for (let row = Math.max(0, y - 2); row <= Math.min(height - 1, y + 2); row++) keep.fill(1, row * width + start, row * width + end)
    }
  }
  let removed = 0
  for (let pixel = 0; pixel < area; pixel++) {
    if (keep[pixel]) continue
    const index = offset(pixel)
    if (data[index + 3]) removed++
    data.fill(0, index, index + 4)
  }
  return removed
}
