/** Keeps the existing planning revision ledger current after a reviewed save.
 * This never confirms a plan or changes event assignments/author decisions. */
export function reviewedOutlineState(content: string, input: { kind: string; legacyId: number; title: string; previousHash: string; nextHash: string; now: string }): string {
  if (!['total', 'volume'].includes(input.kind) || input.previousHash === input.nextHash) return content
  const state = JSON.parse(content) as { total: { revision: number; hash: string; updatedAt?: string }; volumes: Array<{ volume: number; title: string; revision: number; outlineHash: string; eventIds: string[]; createdAt: string; updatedAt: string }> }
  if (input.kind === 'total') {
    state.total.revision = Math.max(1, state.total.revision + (state.total.hash && state.total.hash !== input.previousHash ? 1 : 0) + 1)
    state.total.hash = input.nextHash; state.total.updatedAt = input.now
  } else {
    let volume = state.volumes.find(v => v.volume === input.legacyId)
    if (!volume) { volume = { volume: input.legacyId, title: input.title, revision: 1, outlineHash: input.previousHash, eventIds: [], createdAt: input.now, updatedAt: input.now }; state.volumes.push(volume) }
    volume.revision = Math.max(1, volume.revision + (volume.outlineHash && volume.outlineHash !== input.previousHash ? 1 : 0) + 1)
    volume.outlineHash = input.nextHash; volume.updatedAt = input.now
  }
  return JSON.stringify(state)
}
