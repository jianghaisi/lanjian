// Session presentation only. Disk writes still use the original expected revision.
export const cloneWorkspaceValue = value => JSON.parse(JSON.stringify(value ?? null))

export function captureWorkspaceMemory(project, fields, lastSavedChapter, formBaselines = {}) {
  return {
    id: project.id, path: project.path,
    fields: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, cloneWorkspaceValue(field.value)])),
    lastSavedChapter: fields.selectedId?.value && fields.selectedId.value === lastSavedChapter?.id
      ? cloneWorkspaceValue(lastSavedChapter)
      : { id: null, title: '', content: '', revision: null, bodyVersionId: null },
    formBaselines: cloneWorkspaceValue(formBaselines)
  }
}

export function restoreWorkspaceMemory(snapshot, project, fields) {
  if (!snapshot || snapshot.id !== project.id || snapshot.path !== project.path) return false
  for (const [key, field] of Object.entries(fields)) {
    if (Object.hasOwn(snapshot.fields, key)) field.value = cloneWorkspaceValue(snapshot.fields[key])
  }
  return true
}

const chapterText = chapter => chapter && [chapter.id, chapter.position, chapter.title, chapter.content, chapter.revision, chapter.bodyVersionId]
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function compareWorkspaceMemory(snapshot, bootstrap) {
  if (snapshot.id !== bootstrap.workItem.id || snapshot.path !== bootstrap.workItem.path) throw new Error('作品身份已变化')
  const prior = snapshot.fields
  const selected = bootstrap.chapters.find(chapter => chapter.id === prior.selectedId) ?? null
  const saved = snapshot.lastSavedChapter
  const selectedChanged = Boolean(saved?.id && (!selected || selected.revision !== saved.revision
    || selected.title !== saved.title || selected.content !== saved.content))
  const fresh = {
    totalOutline: bootstrap.outlines.total?.content || '',
    volumeOutline: bootstrap.outlines.volumes.find(volume => volume.volume === prior.selectedVolume)?.content || '',
    stageOutlines: bootstrap.outlines.stages || [],
    standaloneOutlineEntries: bootstrap.outlines.chapterOutlines || [],
    workspaceBootstrapIssues: bootstrap.issues,
    sourceCards: bootstrap.sources.sources, canonicalEvents: bootstrap.events.events,
    eventProjection: bootstrap.eventProjection,
    planningDraft: bootstrap.planningDraft, promptProfile: bootstrap.promptProfile,
    importRecoveries: bootstrap.importRecoveries
  }
  // Editable form values may intentionally differ from disk. Their persisted
  // baselines are handled separately by the existing per-book draft contract.
  const forms = { bookProfile: bootstrap.bookProfile, foundation: bootstrap.foundation,
    realms: bootstrap.realms.levels, powerSystem: bootstrap.powerSystem,
    cheatSystem: bootstrap.cheatSystem, systemTemplate: bootstrap.systemTemplate.template }
  // Recovery of an opening read is not a book-file edit. Actual projection
  // changes are still compared above; only disappearance of the issue differs.
  // New errors and all book-file diagnostics still invalidate normally.
  const previousIssues = prior.workspaceBootstrapIssues?.filter(issue => !['modelSettingsUnreadable', 'unifiedEventsUnreadable'].includes(issue.id)
    || bootstrap.issues?.some(current => current.id === issue.id))
  const changed = selectedChanged
    || !equal(prior.chapters.map(chapterText), bootstrap.chapters.map(chapterText))
    || Object.entries(fresh).some(([key, value]) => Object.hasOwn(prior, key) && !equal(key === 'workspaceBootstrapIssues' ? previousIssues : prior[key], value))
    || Object.entries(forms).some(([key, value]) => Object.hasOwn(snapshot.formBaselines, key)
      && snapshot.formBaselines[key] !== JSON.stringify(value ?? null) && !equal(prior[key], value))
  return { changed, selectedChanged, selected,
    formBaselines: Object.fromEntries(Object.entries(forms).filter(([key]) => Object.hasOwn(snapshot.formBaselines, key))
      .map(([key, value]) => [key, JSON.stringify(value ?? null)])) }
}
