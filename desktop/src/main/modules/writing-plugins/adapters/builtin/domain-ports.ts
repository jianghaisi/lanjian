import type { ProjectService } from '../../../library/application/project-service'
import type { WorkspaceService } from '../../../library/application/workspace-service'
import type { ResearchLibraryService } from '../../../library/application/research-library-service'
import type { DocumentService } from '../../../manuscript/application/document-service'
import type { PlanningJobService } from '../../../planning/application/planning-job-service'
import type { OutlineExpansionTaskService } from '../../../planning/application/outline-expansion-task-service'
import type { WritingAgentService } from '../../../assistant/application/writing-agent-service'
import type { WritingAgentTaskService } from '../../../assistant/application/writing-agent-task-service'

/** Only read/candidate services are accepted. No save, confirm, adopt or filesystem port. */
export type WritingDomainPorts = {
  projects: Pick<ProjectService, 'runBookTask'>
  workspace: Pick<WorkspaceService, 'bookProfile' | 'foundation' | 'realms' | 'powerSystem' | 'cheatSystem' | 'systemTemplate' | 'planningOutline'>
  research: Pick<ResearchLibraryService, 'listSources'>
  documents: Pick<DocumentService, 'chapter'>
  planning: Pick<PlanningJobService, 'start' | 'status' | 'cancel'>
  expansion: Pick<OutlineExpansionTaskService, 'start' | 'status' | 'cancel'>
  writing: Pick<WritingAgentTaskService, 'start' | 'status' | 'cancel'>
  review: Pick<WritingAgentService, 'prepare' | 'run'>
}
export const domainCapabilities = ['book.read', 'planning.read', 'planning.candidate', 'manuscript.read', 'manuscript.candidate', 'review.read'] as const
