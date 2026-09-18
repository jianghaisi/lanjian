import type { WorldMapMarker } from './world-map'

/** Exact, explicitly saved map associations; never split prose or infer place identity. */
export function createWorldMapLocationIndex(markers: readonly WorldMapMarker[]) {
  const sources = new Map<string, Set<string>>()
  for (const marker of markers) {
    for (const source of [marker.location, ...(marker.sourceLocations ?? [])]) {
      let names = sources.get(source)
      if (!names) { names = new Set(); sources.set(source, names) }
      names.add(marker.location)
    }
  }
  return {
    locationsFor(source: string): string[] {
      const raw = source.trim()
      return raw ? [...(sources.get(raw) ?? [raw])] : []
    }
  }
}

export function copyWorldMapMarker(marker: WorldMapMarker): WorldMapMarker {
  return { ...marker, ...(marker.sourceLocations ? { sourceLocations: [...marker.sourceLocations] } : {}) }
}
