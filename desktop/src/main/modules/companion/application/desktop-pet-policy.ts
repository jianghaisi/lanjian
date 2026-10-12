import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import type { DesktopPetCommand, DesktopPetContext, DesktopPetPreferences } from '../../../../contracts/companion/desktop-pet'

export const defaultDesktopPetPreferences: Readonly<DesktopPetPreferences> = Object.freeze({ scale: 1, alwaysOnTop: true, clickThrough: false, positionLocked: false, reminderMinutes: 0 })
export type DesktopPetPosition = { x: number; y: number }
export type StoredDesktopPetPreferences = { enabled: boolean; preferences: DesktopPetPreferences; position: DesktopPetPosition | null }
type WorkArea = DesktopPetPosition & { width: number; height: number }
const statuses = new Set(['', 'idle', 'queued', 'preparing', 'running', 'streaming', 'resuming', 'paused', 'succeeded', 'completed', 'failed', 'cancelled', 'interrupted', 'stopped'])
const invalid = () => new AppError('VALIDATION_ERROR', '桌面伙伴参数无效，请重新设置。', { recoverable: true })
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const result = value as Record<string, unknown>
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw invalid()
  return result
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw invalid()
  return value
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw invalid(); return value }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid()
  return value
}
function preferences(value: unknown, allowLegacy = false): DesktopPetPreferences {
  const legacy = allowLegacy && value !== null && typeof value === 'object' && !Object.hasOwn(value, 'positionLocked')
  const input = record(value, ['scale', 'alwaysOnTop', 'clickThrough', 'reminderMinutes', ...(legacy ? [] : ['positionLocked'])])
  return { scale: number(input.scale, .6, 1.8), alwaysOnTop: boolean(input.alwaysOnTop), clickThrough: boolean(input.clickThrough), positionLocked: legacy ? false : boolean(input.positionLocked), reminderMinutes: number(input.reminderMinutes, 0, 240, true) }
}
function position(value: unknown): DesktopPetPosition {
  const input = record(value, ['x', 'y'])
  return { x: number(input.x, -10_000_000, 10_000_000, true), y: number(input.y, -10_000_000, 10_000_000, true) }
}
function stored(value: unknown, allowLegacy = false): StoredDesktopPetPreferences {
  const legacy = allowLegacy && value !== null && typeof value === 'object' && !Object.hasOwn(value, 'enabled')
  const input = record(value, legacy ? ['preferences', 'position'] : ['enabled', 'preferences', 'position'])
  return { enabled: legacy ? false : boolean(input.enabled), preferences: preferences(input.preferences, allowLegacy), position: input.position === null ? null : position(input.position) }
}

export function decodeDesktopPetContext(value: unknown): DesktopPetContext {
  const input = record(value, ['mode', 'scope', 'taskId', 'taskStatus', 'quiet', 'reducedMotion', 'followPointer', 'autoBlink', 'stateFeedback', 'intensity', 'focusHidden'])
  if (input.mode !== 'detailed' && input.mode !== 'chibi' && input.mode !== 'hidden') throw invalid()
  if (typeof input.taskStatus !== 'string' || !statuses.has(input.taskStatus)) throw invalid()
  return { mode: input.mode, scope: identifier(input.scope), taskId: identifier(input.taskId), taskStatus: input.taskStatus,
    quiet: boolean(input.quiet), reducedMotion: boolean(input.reducedMotion), followPointer: boolean(input.followPointer), autoBlink: boolean(input.autoBlink), stateFeedback: boolean(input.stateFeedback), intensity: number(input.intensity, 0, 1), focusHidden: boolean(input.focusHidden) }
}

export function decodeDesktopPetCommand(value: unknown): DesktopPetCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const type = (value as Record<string, unknown>).type
  switch (type) {
    case 'panel': {
      const input = record(value, ['type', 'panel'])
      if (input.panel !== null && input.panel !== 'menu' && input.panel !== 'chat' && input.panel !== 'care' && input.panel !== 'settings') throw invalid()
      return { type, panel: input.panel }
    }
    case 'enable': { const input = record(value, ['type', 'enabled']); return { type, enabled: boolean(input.enabled) } }
    case 'interaction': { const input = record(value, ['type', 'busy']); return { type, busy: boolean(input.busy) } }
    case 'pointer-press': { const input = record(value, ['type', 'pressed']); return { type, pressed: boolean(input.pressed) } }
    case 'toggle': case 'hide': case 'locate': case 'recover-settings': case 'return-to-writing': case 'settings': case 'drag-start': case 'drag-end':
      record(value, ['type']); return { type }
    case 'hover': {
      const input = record(value, ['type', 'interactive']); return { type, interactive: boolean(input.interactive) }
    }
    case 'regions': {
      const input = record(value, ['type', 'regions'])
      if (!Array.isArray(input.regions) || input.regions.length > 24) throw invalid()
      return { type, regions: input.regions.map(value => {
        const region = record(value, ['x', 'y', 'width', 'height'])
        const width = number(region.width, 0, 4096), height = number(region.height, 0, 4096)
        if (width === 0 || height === 0) throw invalid()
        return { x: number(region.x, 0, 4096), y: number(region.y, 0, 4096), width, height }
      }) }
    }
    case 'mode': {
      const input = record(value, ['type', 'mode'])
      if (input.mode !== 'detailed' && input.mode !== 'chibi') throw invalid()
      return { type, mode: input.mode }
    }
    case 'configure': {
      const input = record(value, ['type', 'preferences']); return { type, preferences: preferences(input.preferences) }
    }
    default: throw invalid()
  }
}

/** Coordinates are Electron DIP, including negative secondary monitor space.
 * If no monitor can contain an oversized window, anchor its top-left on-screen;
 * the window owner must reduce its size to make the remainder visible. */
export function restoreDesktopPetPosition(saved: DesktopPetPosition | null, size: { width: number; height: number }, workAreas: WorkArea[], fallbackPoint?: DesktopPetPosition): DesktopPetPosition {
  const current = saved === null ? null : position(saved)
  const width = Math.ceil(number(size?.width, 1, 1_000_000)), height = Math.ceil(number(size?.height, 1, 1_000_000))
  if (!Array.isArray(workAreas) || !workAreas.length || workAreas.length > 100) throw invalid()
  const areas = workAreas.map(area => ({ ...position({ x: area?.x, y: area?.y }), width: number(area?.width, 1, 1_000_000, true), height: number(area?.height, 1, 1_000_000, true) }))
  const fallback = fallbackPoint === undefined ? null : position(fallbackPoint)
  const fits = (area: WorkArea, point: DesktopPetPosition) => point.x >= area.x && point.y >= area.y && point.x + width <= area.x + area.width && point.y + height <= area.y + area.height
  if (current && areas.some(area => fits(area, current))) return { ...current }
  const fitting = areas.filter(area => area.width >= width && area.height >= height)
  const candidates = fitting.length ? fitting : areas
  const origin = fallback ?? current
  const distance = (area: WorkArea) => origin ? Math.max(area.x - origin.x, 0, origin.x - area.x - area.width) ** 2 + Math.max(area.y - origin.y, 0, origin.y - area.y - area.height) ** 2 : 0
  const area = candidates.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest)
  const target = origin ?? { x: area.x + Math.max(0, area.width - width - 24), y: area.y + Math.max(0, area.height - height - 24) }
  return { x: Math.min(area.x + Math.max(0, area.width - width), Math.max(area.x, target.x)), y: Math.min(area.y + Math.max(0, area.height - height), Math.max(area.y, target.y)) }
}

/** The directory is trusted main-process userData, never supplied by renderer.
 * A malformed existing file blocks saves too, preserving recovery evidence. */
export class DesktopPetPreferencesStore {
  private readonly file: string
  private operations: Promise<void> = Promise.resolve()
  constructor(private readonly directory: string, private readonly writer: (path: string, text: string) => Promise<void> = atomicWriteText) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) throw invalid()
    this.file = join(directory, 'desktop-pet.json')
  }
  read(): Promise<StoredDesktopPetPreferences> { return this.exclusive(() => this.readNow()) }
  recover(): Promise<StoredDesktopPetPreferences> { return this.exclusive(async () => {
    try { const info = await lstat(this.file); if (!info.isFile() || info.isSymbolicLink()) throw invalid(); await copyFile(this.file, `${this.file}.${randomUUID()}.bak`) }
    catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')) throw new AppError('STORAGE_ERROR', '桌宠设置未能备份，恢复已取消。', { recoverable: true, cause }) }
    const next = { enabled: false, preferences: { ...defaultDesktopPetPreferences }, position: null }
    try { await mkdir(this.directory, { recursive: true }); await this.writer(this.file, `${JSON.stringify(next, null, 2)}\n`) }
    catch (cause) { throw new AppError('STORAGE_ERROR', '新设置未能保存，原记录备份已保留。', { recoverable: true, cause }) }
    return next
  }) }
  async save(value: StoredDesktopPetPreferences): Promise<void> {
    const snapshot = stored(value)
    return this.exclusive(async () => {
      await this.readNow()
      try {
        await mkdir(this.directory, { recursive: true })
        await this.writer(this.file, `${JSON.stringify(snapshot, null, 2)}\n`)
      } catch (cause) {
        throw new AppError('STORAGE_ERROR', '桌面伙伴设置未能保存，现有设置未被主动清除，请重试。', { recoverable: true, cause })
      }
    })
  }
  private async readNow(): Promise<StoredDesktopPetPreferences> {
    try {
      const info = await lstat(this.file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) throw invalid()
      return stored(JSON.parse(await readFile(this.file, 'utf8')), true)
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
        const names = await readdir(this.directory).catch(reason => { if (reason?.code === 'ENOENT') return []; throw invalid() })
        if (!names.some(name => name.startsWith('desktop-pet.json.') && name.endsWith('.efs-backup'))) return { enabled: false, preferences: { ...defaultDesktopPetPreferences }, position: null }
      }
      throw new AppError('STORAGE_ERROR', '桌面伙伴设置无法读取，原文件已保留，请检查设置文件后重试。', { recoverable: true, cause })
    }
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation)
    this.operations = result.then(() => undefined, () => undefined)
    return result
  }
}
