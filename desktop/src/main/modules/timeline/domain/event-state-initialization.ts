export type EventStateInitializationPlan = Readonly<{
  operationId: string
  projectId: string
  committedAt: string
  eventIds: readonly string[]
  orderHash: string
}>

export interface EventStateInitializationWritePort {
  initialize(plan: EventStateInitializationPlan, assertActive: () => void): void
  close(): void
}
