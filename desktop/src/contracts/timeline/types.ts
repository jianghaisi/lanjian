export type EvidenceRef = { sourceId: string; excerpt: string }

export type CanonicalEvent = {
  id: string
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
  evidenceRefs: EvidenceRef[]
  confidence: number
  status: 'candidate' | 'approved'
  conflictGroupId?: string
  createdAt: string
  approvedAt?: string
}

export type EventCandidateCreateInput = {
  sourceId: string
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
}

export type TimelineEvent = {
  id: string
  /** Short label used by the collapsed timeline. Older projects derive it from `event`. */
  title?: string
  time: string
  characters: string
  location: string
  event: string
  result?: string
}
