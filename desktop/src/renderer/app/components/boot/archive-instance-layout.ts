import { archiveOpen, archiveWave, ease, progress } from './cinematic-timeline'
import type { TypedArray } from 'three'

export const DOSSIER_WIDTH = 7.2
export const DOSSIER_HEIGHT = 3.4
const SCALE = .85

export function createArchiveCells() {
  const cells = []
  for (let lane = -8; lane <= 8; lane++) {
    for (let row = -130; row <= 130; row++) {
      if (lane === 0 && row === 0) continue
      cells.push({ lane, row,
        shoulder: .8 * Math.exp(-(((Math.abs(row) - 6) / 5) ** 2)) * Math.exp(-Math.abs(lane) * .8),
        spread: .08 * Math.exp(-Math.abs(row) * .13) * Math.exp(-Math.abs(lane)),
      })
    }
  }
  return cells
}

// These four matrices have only uniform scale and X rotation. Writing them directly
// preserves the Object3D composition without four repeated compositions/copies per cell.
function writeMatrix(buffer: TypedArray, offset: number, x: number, y: number, z: number, c: number, s: number) {
  buffer[offset] = SCALE; buffer[offset + 1] = 0; buffer[offset + 2] = 0; buffer[offset + 3] = 0
  buffer[offset + 4] = 0; buffer[offset + 5] = c * SCALE; buffer[offset + 6] = s * SCALE; buffer[offset + 7] = 0
  buffer[offset + 8] = 0; buffer[offset + 9] = -s * SCALE; buffer[offset + 10] = c * SCALE; buffer[offset + 11] = 0
  buffer[offset + 12] = x; buffer[offset + 13] = y; buffer[offset + 14] = z; buffer[offset + 15] = 1
}

export function updateArchiveMatrices(cells: ReturnType<typeof createArchiveCells>, buffers: readonly TypedArray[], time: number, waveTime = time) {
  const shoulderEnvelope = ease(progress(time, 19.8, 21.5)) * (1 - ease(progress(time, 22.5, 25)))
  const spreadEnvelope = ease(progress(time, 21, 24))
  const railY = (DOSSIER_HEIGHT / 2 - .015) * SCALE
  const signalX = (-DOSSIER_WIDTH / 2 + .09) * SCALE, signalZ = .092 * SCALE
  const rivetX = signalX + .15 * SCALE, rivetY = (DOSSIER_HEIGHT / 2 - .22) * SCALE, rivetZ = signalZ + .055 * SCALE
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!, wave = archiveWave(cell.row, cell.lane, waveTime)
    const x = cell.lane * 7.2
    const y = DOSSIER_HEIGHT * SCALE / 2 + (wave + cell.shoulder * shoulderEnvelope) * SCALE - (1 - archiveOpen(cell.row, cell.lane, time)) * 5
    const z = cell.row * (.92 + cell.spread * spreadEnvelope)
    const c = Math.cos(-.025 * wave), s = Math.sin(-.025 * wave), offset = i * 16
    writeMatrix(buffers[0]!, offset, x, y, z, c, s)
    writeMatrix(buffers[1]!, offset, x, y + railY * c, z + railY * s, c, s)
    writeMatrix(buffers[2]!, offset, x + signalX, y - signalZ * s, z + signalZ * c, c, s)
    writeMatrix(buffers[3]!, offset, x + rivetX, y + rivetY * c - rivetZ * s, z + rivetY * s + rivetZ * c, c, s)
  }
}
