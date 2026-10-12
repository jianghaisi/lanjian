export type PetRegistration = {
  size: number[]
  density: number
  frames: { rect: number[]; anchor: number[] }[]
  pages?: { file: string; origin: number[]; size: number[]; density?: number }[]
}

/** Fixed source-pixel density per atlas page, never a per-pose size fit. */
export function petFrameDensity(registration: PetRegistration, index: number): number {
  const [x, y, width, height] = registration.frames[index]!.rect as [number, number, number, number]
  const page = registration.pages?.find(page => x >= page.origin[0]! && y >= page.origin[1]!
    && x + width <= page.origin[0]! + page.size[0]! && y + height <= page.origin[1]! + page.size[1]!)
  return page?.density ?? registration.density
}
