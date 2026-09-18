import { AppError } from '../../../core/errors/app-error'
import { canonicalDirectory } from '../../../platform/storage/project-path'
import type { Chapter, ProjectSummary } from '../../../../contracts/index'
import { decodeWorldMapView, type WorldMapEvent, type WorldMapLayoutView, type WorldMapView } from '../../../../contracts/world-map/world-map'

type Projects = { currentPath(): Promise<string>; currentSummary(): Promise<Pick<ProjectSummary, 'id' | 'path'>> }
type Events = { worldMapEvents(): Promise<WorldMapEvent[]> }
type Chapters = { chapters(): Promise<Pick<Chapter, 'id' | 'position' | 'title'>[]> }
type MapLayout = { read(): Promise<WorldMapLayoutView> }
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right
const changed = () => new AppError('CONFLICT', '作品或地图来源在读取期间变化，请重新读取；未拼接不同版本的数据。', { recoverable: true })

/** One workspace-bound view. Coordinate persistence is owned by WorldMapService.
 * Existing source readers retain their own authority/cache semantics; this
 * aggregation never imports or writes facts, chapters, placements or map data. */
export class WorldMapWorkspaceService {
  constructor(private readonly projects: Projects, private readonly events: Events, private readonly chapters: Chapters, private readonly map: MapLayout) {}

  async read(): Promise<WorldMapView> {
    const root = await canonicalDirectory(await this.projects.currentPath())
    const identity = await this.projects.currentSummary()
    if (!samePath(root, await canonicalDirectory(identity.path))) throw changed()
    const assertCurrent = async () => {
      const currentRoot = await canonicalDirectory(await this.projects.currentPath())
      if (!samePath(root, currentRoot)) throw changed()
      const current = await this.projects.currentSummary()
      if (current.id !== identity.id || !samePath(root, await canonicalDirectory(current.path))) throw changed()
    }
    const snapshot = async (): Promise<{ view: WorldMapView; source: string }> => {
      await assertCurrent()
      const [layout, events, chapters] = await Promise.all([this.map.read(), this.events.worldMapEvents(), this.chapters.chapters()])
      await assertCurrent()
      if (layout.workItemId !== identity.id) throw changed()
      // Explicit missing/archived chapter links remain null; no display index
      // is ever substituted for a stable source chapter identity.
      const chapterIds = new Set(chapters.map(chapter => chapter.id))
      const view = {
        ...layout,
        events: events.map(event => ({ ...event, characters: [...event.characters], chapterId: event.chapterId !== null && chapterIds.has(event.chapterId) ? event.chapterId : null })),
        chapters: chapters.map(({ id, position, title }) => ({ id, position, title }))
      }
      // Compare original explicit links too: different dangling links must not
      // both become null and conceal a mutation between the two snapshots.
      return { view: decodeWorldMapView(view), source: JSON.stringify({ ...view, events }) }
    }
    try {
      const first = await snapshot()
      const second = await snapshot()
      if (first.source !== second.source || JSON.stringify(first.view) !== JSON.stringify(second.view)) throw changed()
      await assertCurrent()
      return second.view
    } catch (error) {
      // A late failure from the previous work item must not be reported as a
      // data error belonging to the newly opened book.
      await assertCurrent()
      throw error
    }
  }
}
