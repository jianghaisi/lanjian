export function activeEventRows(projection) {
  if (!projection) return []
  const lifecycles = new Map(projection.state.lifecycles.map((item) => [item.eventId, item]))
  return projection.approved.map((item) => eventRow(item, lifecycles.get(item.eventId)))
}

export function archivedEventRows(projection) {
  if (!projection) return []
  return projection.archived.flatMap((item) => {
    const version = item.candidate || item.approved
    return version ? [eventRow(version, item.lifecycle)] : []
  })
}

export function candidateEventRows(projection) {
  if (!projection) return []
  const lifecycles = new Map(projection.state.lifecycles.map((item) => [item.eventId, item]))
  return projection.candidates.map((item) => ({ ...eventRow(item, lifecycles.get(item.eventId)), _unifiedCandidate: true }))
}

export function eventRow(version, lifecycle) {
  const content = version.content
  const row = {
    id: version.eventId,
    title: content.title || '',
    time: content.time,
    characters: [...content.characters],
    location: content.location,
    event: content.event,
    result: content.result || '',
    evidenceRefs: content.evidenceRefs.map((item) => ({ ...item })),
    confidence: content.confidence,
    versionId: version.versionId,
    lifecycleId: lifecycle?.id || '',
    granularity: version.granularity,
    phase: version.phase,
    ...(version.settlement ? { settlement: { ...version.settlement } } : {}),
    creator: version.creator,
    sources: version.sources.map((item) => ({ relation: item.relation, source: { ...item.source } }))
  }
  return { ...row, _baseline: JSON.stringify(eventContentFromRow(row)) }
}

export function eventContentFromRow(row) {
  const characters = Array.isArray(row.characters)
    ? row.characters.map((item) => String(item).trim()).filter(Boolean)
    : String(row.characters || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  return {
    time: String(row.time || '').trim(),
    characters,
    location: String(row.location || '').trim(),
    event: String(row.event || '').trim(),
    result: String(row.result || '').trim(),
    evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.map((item) => ({ ...item })) : [],
    confidence: typeof row.confidence === 'number' ? row.confidence : 1,
    title: String(row.title || '').trim(),
    rawCharacters: characters.join('、')
  }
}

export function eventRowChanged(row) {
  return row._new === true || row._baseline !== JSON.stringify(eventContentFromRow(row))
}
