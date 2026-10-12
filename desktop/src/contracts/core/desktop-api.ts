import type { LocalModelsApi } from '../models/local-model-contracts'
import type { ModelConnectionsApi } from '../models/model-connections-contracts'
import type { DesktopAppApi } from './app-api'
import type { DesktopProjectsApi } from '../library/projects-api'
import type { DesktopChaptersApi } from '../manuscript/chapters-api'
import type { DesktopImportsApi } from '../library/imports-api'
import type { DesktopOutlinesApi } from '../planning/outlines-api'
import type { DesktopChapterOutlinesApi } from '../planning/chapter-outlines-api'
import type { DocumentReviewApi } from '../document-review/api'
import type { DesktopAiApi } from '../models/ai-api'
import type { DesktopPlanningApi } from '../planning/planning-api'
import type { DesktopResearchApi } from '../worldbuilding/research-api'
import type { DesktopWorkspaceApi } from './workspace-api'
import type { DesktopEventsApi } from '../timeline/event-contracts'

export type DesktopApi = {
  inspiration: import('../inspiration/types').InspirationApi
  groupChat: import('../group-chat/group-chat').GroupChatApi
  documentReview: DocumentReviewApi
  writingPlugins: import('../writing-plugins/management-contracts').WritingPluginsApi
  events: DesktopEventsApi
  modelConnections: ModelConnectionsApi
  companionVoice: import('../companion/companion-voice-contracts').CompanionVoiceApi
  fieldAssistant: import('../assistant/field-assistant-contracts').FieldAssistantApi
  app: DesktopAppApi
  projects: DesktopProjectsApi
  chapters: DesktopChaptersApi
  imports: DesktopImportsApi
  outlines: DesktopOutlinesApi
  chapterOutlines: DesktopChapterOutlinesApi
  localModels: LocalModelsApi
  ai: DesktopAiApi
  planning: DesktopPlanningApi
  research: DesktopResearchApi
  workspace: DesktopWorkspaceApi
}
