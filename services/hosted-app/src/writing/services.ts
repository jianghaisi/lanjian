import type { BookRuntime } from './book-runtime.ts'
import type { AiClient } from '../../../../desktop/src/main/modules/models/application/ai-client'
import { ChapterDraftService } from '../../../../desktop/src/main/modules/manuscript/application/chapter-draft-service'
import { WritingAgentService } from '../../../../desktop/src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../../../desktop/src/main/modules/assistant/application/writing-agent-task-service'
import { WritingAgentApprovalService } from '../../../../desktop/src/main/modules/assistant/application/writing-agent-approval-service'
import { PlanningPackageService } from '../../../../desktop/src/main/modules/planning/application/planning-package-service'
import { PlanningDraftService } from '../../../../desktop/src/main/modules/planning/application/planning-draft-service'
import { FoundationDraftService } from '../../../../desktop/src/main/modules/planning/application/foundation-draft-service'
import { ChapterSkeletonService } from '../../../../desktop/src/main/modules/planning/application/chapter-skeleton-service'
import { ChapterDetailService } from '../../../../desktop/src/main/modules/planning/application/chapter-detail-service'
import { DocumentReviewService } from '../../../../desktop/src/main/modules/document-review/application/document-review-service'

export function writingServices(r: BookRuntime, ai: AiClient) {
  const draft = new ChapterDraftService(ai, r.documents, r.workspace)
  const agent = new WritingAgentService(ai, r.projects, r.documents, r.workspace, draft)
  const tasks = new WritingAgentTaskService(agent, r.projects, r.databases, undefined, undefined, undefined, r.writes)
  const approvals = new WritingAgentApprovalService(r.projects, r.documents, tasks, r.databases, root => r.manuscripts.retryMirrors(root), r.writes)
  const packages = new PlanningPackageService(r.projects, r.planning, r.documents, undefined, r.characters, r.workspace)
  const planning = new PlanningDraftService(ai, r.workspace)
  const foundation = new FoundationDraftService(ai, r.workspace)
  const skeletons = new ChapterSkeletonService(ai, packages, r.planning, r.workspace)
  const details = new ChapterDetailService(ai, packages, r.planning, r.workspace)
  const review = new DocumentReviewService(r.projects, tasks, r.databases, root => r.manuscripts.retryMirrors(root), r.writes)
  return { draft, agent, tasks, approvals, packages, planning, foundation, skeletons, details, review }
}
