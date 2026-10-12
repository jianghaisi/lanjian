const prefix = 'lanjian:event-edit-session:v1:'

function storage() {
  try { return globalThis.localStorage || null } catch { return null }
}

function key(workItemId) {
  return `${prefix}${encodeURIComponent(workItemId)}`
}

export function readEventEditSession(workItemId) {
  const target = storage()
  if (!target || !workItemId) return null
  try {
    const value = JSON.parse(target.getItem(key(workItemId)) || 'null')
    if (!value || value.version !== 1 || value.workItemId !== workItemId || typeof value.baseRevision !== 'string'
      || !Array.isArray(value.rows) || (value.pending !== null && (!value.pending || typeof value.pending.operationId !== 'string')))
      return null
    return value
  } catch { return null }
}

export function writeEventEditSession(workItemId, baseRevision, rows, pending = null) {
  const target = storage()
  if (!target || !workItemId || !baseRevision) return
  try {
    target.setItem(key(workItemId), JSON.stringify({
      version: 1,
      workItemId,
      baseRevision,
      rows: JSON.parse(JSON.stringify(rows)),
      pending
    }))
  } catch { /* The in-memory draft remains usable when browser storage is unavailable. */ }
}

export function clearEventEditSession(workItemId) {
  const target = storage()
  if (!target || !workItemId) return
  try { target.removeItem(key(workItemId)) } catch { /* no-op */ }
}
