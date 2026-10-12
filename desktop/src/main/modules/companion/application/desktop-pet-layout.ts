import type { DesktopPetLayout, DesktopPetPanel, DesktopPetRect } from '../../../../contracts/companion/desktop-pet'
import { DESKTOP_PET_MENU_MARGIN } from '../../../../contracts/companion/desktop-pet'

const panelSizes = { menu: [304, 390], chat: [360, 560], care: [360, 540], settings: [420, 640] } as const
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), value))

/** Main-owned DIP geometry. Opening a panel never changes the stored home or scale. */
export function layoutDesktopPet(home: DesktopPetRect, scale: number, kind: DesktopPetPanel | null, area: DesktopPetRect): { bounds: DesktopPetRect; layout: DesktopPetLayout } {
  // Fit the selected size to the display before considering a panel. Keep the
  // artwork's aspect ratio and leave room for its caption and native DPI rounding.
  // This effective size is transient; opening settings never applies another fit.
  const fittedScale = Math.min(scale, home.width * .9 / 230, Math.max(1, home.height - 48) / 240)
  const width = 230 * fittedScale, height = 240 * fittedScale + 32
  const pet = { x: home.x + home.width - 10 - width, y: home.y + home.height - 8 - height, width, height }
  if (!kind) return { bounds: { ...home }, layout: { pet: { ...pet, x: pet.x - home.x, y: pet.y - home.y }, panel: null, side: null, kind: null } }
  if (kind === 'menu') {
    const margin = 8
    const panelWidth = Math.min(area.width - margin * 2, pet.width + DESKTOP_PET_MENU_MARGIN * 2)
    const panelHeight = Math.min(area.height - margin * 2, pet.height + DESKTOP_PET_MENU_MARGIN * 2)
    const panel = { x: clamp(pet.x + pet.width / 2 - panelWidth / 2, area.x + margin, area.x + area.width - margin - panelWidth),
      y: clamp(pet.y + pet.height / 2 - panelHeight / 2, area.y + margin, area.y + area.height - margin - panelHeight), width: panelWidth, height: panelHeight }
    // Temporarily center the intact character in its compact orbit. Expanded
    // placement never writes the temporary origin into the saved home.
    pet.x = panel.x + (panel.width - pet.width) / 2
    pet.y = panel.y + (panel.height - pet.height) / 2
    const bounds = { x: Math.floor(panel.x - margin), y: Math.floor(panel.y - margin), width: Math.ceil(panel.width + margin * 2), height: Math.ceil(panel.height + margin * 2) }
    return { bounds, layout: { pet: { ...pet, x: pet.x - bounds.x, y: pet.y - bounds.y }, panel: { ...panel, x: panel.x - bounds.x, y: panel.y - bounds.y }, side: pet.x + pet.width / 2 > area.x + area.width / 2 ? 'left' : 'right', kind } }
  }
  const margin = 8, gap = 16, [desiredWidth, desiredHeight] = panelSizes[kind]
  const left = pet.x - area.x - margin - gap, right = area.x + area.width - margin - pet.x - pet.width - gap
  const side = left >= right ? 'left' : 'right'
  const totalSpace = Math.max(1, area.width - pet.width - gap - margin * 2)
  const panelWidth = Math.min(desiredWidth, totalSpace, Math.max(left, right, Math.min(280, totalSpace)))
  const panelHeight = Math.min(desiredHeight, Math.max(1, area.height - margin * 2))
  // Only a cramped display needs temporary horizontal room. The home itself
  // stays intact, so closing always restores the author's original placement.
  if (side === 'left') pet.x = Math.max(pet.x, area.x + margin + panelWidth + gap)
  else pet.x = Math.min(pet.x, area.x + area.width - margin - panelWidth - gap - pet.width)
  const panel = { x: side === 'left' ? pet.x - gap - panelWidth : pet.x + pet.width + gap,
    y: clamp(pet.y + pet.height - panelHeight, area.y + margin, area.y + area.height - margin - panelHeight), width: panelWidth, height: panelHeight }
  const x = Math.floor(Math.min(pet.x, panel.x) - margin), y = Math.floor(Math.min(pet.y, panel.y) - margin)
  const bounds = { x, y, width: Math.ceil(Math.max(pet.x + pet.width, panel.x + panel.width) + margin - x), height: Math.ceil(Math.max(pet.y + pet.height, panel.y + panel.height) + margin - y) }
  return { bounds, layout: { pet: { ...pet, x: pet.x - x, y: pet.y - y }, panel: { ...panel, x: panel.x - x, y: panel.y - y }, side, kind } }
}
