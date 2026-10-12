import type { ProjectSummary } from '../../../../contracts/index'

/** Same projection for the library and its cinematic arrival; no new recency store. */
export function selectContinueProject(projects: readonly ProjectSummary[], id?: string | null) {
  return projects.find(project => project.id === id) ?? projects[0]
}
