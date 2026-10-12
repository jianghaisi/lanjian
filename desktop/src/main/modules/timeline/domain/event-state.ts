/** Main-private verified state. Approval, story phase and lifecycle are separate. */
export type EventLifecycle = Readonly<{
  id: string
  eventId: string
  revision: number
  expectedEventVersionId: string
  state: 'active' | 'archived'
  createdAt: string
}>

export type EventDisplayOrder = Readonly<{
  id: string
  revision: number
  eventIds: readonly string[]
  contentHash: string
  createdAt: string
}>

export type EventStateSnapshot = Readonly<{
  order: EventDisplayOrder
  lifecycles: readonly EventLifecycle[]
}>
