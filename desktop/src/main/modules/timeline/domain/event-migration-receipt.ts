/** Historical commit evidence only; never a grant to retry writes or switch consumers. */
export type EventMigrationReceipt = Readonly<{
  operationId: string
  projectId: string
  sourceFingerprint: string
  decisionFingerprint: string
  committedAt: string
  mappingCount: number
  sourceCounts: Readonly<{ sources: number; events: number; timeline: number }>
}>
