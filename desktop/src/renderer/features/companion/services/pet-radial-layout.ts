import { DESKTOP_PET_MENU_MARGIN } from '../../../../contracts/companion/desktop-pet'

export type PetRadialAction = 'chat' | 'care' | 'food' | 'water' | 'sleep' | 'pat' | 'handshake' | 'greet' | 'dice' | 'inspiration' | 'focus' | 'settings' | 'voice' | 'lock' | 'writing' | 'hide'
export type OrbitPoint = { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function petRadialLayout(width: number, height: number, petWidth: number, petHeight: number, parent = -1, children = 0) {
  const compact = height + .01 < petHeight + DESKTOP_PET_MENU_MARGIN * 2
  const center = { x: width / 2, y: height / 2 }
  const angles = [-150, -90, -30, 30, 90, 150]
  const columns = [[-1,.23],[-1,.5],[1,.23],[1,.5],[1,.77],[-1,.77]] as const
  const point = (angle: number, rx: number, ry: number) => ({ x: center.x + Math.cos(angle * Math.PI / 180) * rx, y: center.y + Math.sin(angle * Math.PI / 180) * ry })
  const primary = angles.map((angle, index) => compact
    ? { x: center.x + columns[index]![0] * (petWidth / 2 + 34), y: height * columns[index]![1] }
    : point(angle, petWidth / 2 + 30, petHeight / 2 + 34))
  const secondary: OrbitPoint[] = []
  if (parent >= 0 && parent < primary.length && children > 0) {
    const step = Math.min(60, (height - 68) / Math.max(1, children - 1))
    const span = (children - 1) * step
    const start = clamp(primary[parent]!.y - span / 2, 34, height - 34 - span)
    for (let index = 0; index < children; index++) {
      secondary.push(compact ? { x: columns[parent]![0] < 0 ? 32 : width - 32, y: start + index * step }
        : point(angles[parent]! + (index - (children - 1) / 2) * 24, width / 2 - 32, height / 2 - 32))
    }
  }
  return { center, compact, primary, secondary }
}
