// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createWorldbuildingMaterialsActions(ports) {
  function applyFoundationDraft() {
    if (!ports.foundationDraft.value) return
    ports.foundation.value.worldView = ports.foundationDraft.value.worldView
    ports.foundation.value.useRealms = ports.foundationDraft.value.useRealms
    ports.foundation.value.useSystem = ports.foundationDraft.value.useSystem
    ports.realms.value = ports.foundationDraft.value.realms.map((item) => ({ ...item }))
    ports.systemTemplate.value = ports.foundationDraft.value.systemTemplate
    ports.foundationDraft.value = null
    ports.active.value = 'world'
    ports.notice('候选已放入设定编辑器；修改并保存后才会成为正式设定')
  }

  async function saveResearchSettings() {
    const result = await ports.guard(
      () =>
        ports.desktop.research.updateSettings({
          baseUrl: ports.researchSettings.value.baseUrl,
          model: ports.researchSettings.value.model,
          apiKey: ports.researchSettings.value.apiKey || undefined
        }),
      '联网采风设置已保存'
    )
    ports.researchSettings.value = { ...result, apiKey: '' }
  }

  async function runResearch() {
    ports.researchResult.value = await ports.guard(
      () => ports.desktop.research.search(ports.researchQuery.value),
      '联网采风完成，请核对来源后再加入资料'
    )
  }

  async function addResearchToMaterials() {
    if (!ports.researchResult.value?.sources.length) return
    const result = ports.researchResult.value
    const created = await ports.guard(
      () =>
        ports.desktop.research.createSource(
          ports.plainDto({
            title: `联网采风：${result.query}`,
            sourceType: 'web',
            provider: result.model,
            excerpt: result.content,
            userNotes: `检索词：${result.searchedQueries.join('、')}`,
            references: result.sources
          })
        ),
      '联网采风已作为可追溯资料卡加入本书'
    )
    ports.sourceCards.value = [created, ...ports.sourceCards.value]
    ports.researchResult.value = null
    openSourceCard(created, true)
    await ports.refreshWorkflow()
  }

  function resetSourceDraft() {
    ports.sourceDraft.value = { title: '', url: '', author: '', publishedAt: '', excerpt: '', userNotes: '' }
  }

  function resetIdeaDraft() {
    ports.ideaGenerationSource.value = null
    ports.ideaSourceLoad += 1
    ports.ideaSourceTask.value = null
    ports.ideaSourceIssue.value = ''
    ports.ideaDraft.value = { title: '', content: '', status: 'candidate' }
  }

  function canLeaveSourceDraft() {
    return !ports.sourceDraftDirty.value || window.confirm('这条素材还有修改尚未保存。放弃修改并继续吗？')
  }

  function chooseMaterialSection(section) {
    if (section === ports.materialSection.value) return
    if (!canLeaveSourceDraft()) return
    if (ports.materialSection.value === 'notes' && !ports.canLeaveIdeaDraft()) return
    ports.materialSection.value = section
    ports.materialSearch.value = ''
    ports.selectedSourceId.value = ''
    ports.creatingSource.value = false
    resetSourceDraft()
  }

  function openSourceCard(source, force = false) {
    if (!force && source.id !== ports.selectedSourceId.value && !canLeaveSourceDraft()) return
    ports.selectedSourceId.value = source.id
    ports.creatingSource.value = false
    ports.sourceDraft.value = {
      title: source.title,
      url: source.url || '',
      author: source.author || '',
      publishedAt: source.publishedAt || '',
      excerpt: source.excerpt,
      userNotes: source.userNotes
    }
  }

  function startSourceCard() {
    if (!canLeaveSourceDraft()) return
    ports.materialSection.value = 'manual'
    ports.selectedSourceId.value = ''
    ports.creatingSource.value = true
    resetSourceDraft()
  }

  async function saveSourceCard() {
    if (ports.selectedSource.value) {
      const source = ports.selectedSource.value
      const input =
        source.sourceType === 'manual'
          ? {
              title: ports.sourceDraft.value.title,
              url: ports.sourceDraft.value.url,
              author: ports.sourceDraft.value.author,
              publishedAt: ports.sourceDraft.value.publishedAt,
              excerpt: ports.sourceDraft.value.excerpt,
              userNotes: ports.sourceDraft.value.userNotes
            }
          : { title: ports.sourceDraft.value.title, userNotes: ports.sourceDraft.value.userNotes }
      const updated = await ports.guard(
        () => ports.desktop.research.updateSource(source.id, ports.plainDto(input)),
        '素材修改已保存到当前作品'
      )
      const index = ports.sourceCards.value.findIndex((item) => item.id === updated.id)
      if (index >= 0) ports.sourceCards.value.splice(index, 1, updated)
      openSourceCard(updated, true)
      return
    }
    const created = await ports.guard(
      () => ports.desktop.research.createSource(ports.plainDto(ports.sourceDraft.value)),
      '资料卡已保存，尚未成为作品事件'
    )
    ports.sourceCards.value = [created, ...ports.sourceCards.value]
    openSourceCard(created, true)
  }

  function beginEventCandidate(source) {
    if (!canLeaveSourceDraft()) return
    ports.materialSection.value = 'events'
    ports.eventDraft.value = { sourceId: source.id, time: '', characters: '', location: '', event: '', result: '' }
  }

  function sourceOriginLabel(source) {
    return source.sourceType === 'manual' ? '自备资料' : '联网采风'
  }

  return {
    applyFoundationDraft,
    saveResearchSettings,
    runResearch,
    addResearchToMaterials,
    resetSourceDraft,
    resetIdeaDraft,
    canLeaveSourceDraft,
    chooseMaterialSection,
    openSourceCard,
    startSourceCard,
    saveSourceCard,
    beginEventCandidate,
    sourceOriginLabel
  }
}
