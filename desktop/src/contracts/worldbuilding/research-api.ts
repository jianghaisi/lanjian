import type {
  ResearchResult,
  ResearchSettings,
  SourceCard,
  SourceCardCreateInput,
  SourceCardUpdateInput
} from './types'
import type { CanonicalEvent, EventCandidateCreateInput } from '../timeline/types'

export type DesktopResearchApi = {
  getSettings: () => Promise<ResearchSettings>
  updateSettings: (input: {
    baseUrl?: string
    model?: string
    apiKey?: string
    clearApiKey?: boolean
  }) => Promise<ResearchSettings>
  search: (query: string) => Promise<ResearchResult>
  listSources: () => Promise<{ sources: SourceCard[] }>
  createSource: (input: SourceCardCreateInput) => Promise<SourceCard>
  updateSource: (id: string, input: SourceCardUpdateInput) => Promise<SourceCard>
  listEvents: () => Promise<{ events: CanonicalEvent[] }>
  createEventCandidate: (input: EventCandidateCreateInput) => Promise<CanonicalEvent>
  approveEvent: (id: string) => Promise<CanonicalEvent>
}
