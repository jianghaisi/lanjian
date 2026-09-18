// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createCharactersEntitiesActions(ports) {
  async function loadCharacterAliases() {
    if (!ports.current.value || !ports.desktop?.workspace?.listCharacterAliases) return
    try {
      ports.characterAliases.value = await ports.desktop.workspace.listCharacterAliases()
      ports.characterAliasesLoaded.value = true
    } catch {
      ports.characterAliases.value = []
      ports.characterAliasesLoaded.value = false
    }
  }

  function editCharacterAliases(item) {
    ports.characterAliasDraft.value = { canonicalName: item.canonicalName, aliasesText: item.aliases.join('、') }
  }

  async function saveCharacterAliases() {
    const canonicalName = ports.characterAliasDraft.value.canonicalName.trim()
    if (!canonicalName) return ports.notice('请先填写人物本名')
    const aliases = ports.characterAliasDraft.value.aliasesText
      .split(/[、，,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
    await ports.guard(
      () => ports.desktop.workspace.replaceCharacterAliases({ canonicalName, aliases }),
      `“${canonicalName}”的人物别名已保存`
    )
    ports.characterAliasDraft.value = { canonicalName: '', aliasesText: '' }
    await loadCharacterAliases()
  }

  async function loadStoryEntities() {
    if (!ports.current.value || !ports.desktop?.workspace?.listStoryEntities) return
    try {
      const [entities, relations, ledger] = await Promise.all([
        ports.desktop.workspace.listStoryEntities(),
        ports.desktop.workspace.listStoryEntityRelations(),
        ports.desktop.workspace.getResourceLedger
          ? ports.desktop.workspace.getResourceLedger()
          : Promise.resolve({ balances: [], entries: [] })
      ])
      ports.storyEntities.value = entities
      ports.storyEntityRelations.value = relations
      ports.resourceLedger.value = ledger
      const approvedResourceIds = new Set(
        entities.filter((item) => item.entityType === 'item' && item.status === 'approved').map((item) => item.id)
      )
      if (!approvedResourceIds.has(ports.resourceLedgerDraft.value.resourceEntityId)) {
        ports.resourceLedgerDraft.value.resourceEntityId =
          entities.find((item) => item.entityType === 'item' && item.status === 'approved')?.id || ''
      }
      ports.storyEntitiesLoaded.value = true
    } catch {
      ports.storyEntities.value = []
      ports.storyEntityRelations.value = []
      ports.resourceLedger.value = { balances: [], entries: [] }
      ports.storyEntitiesLoaded.value = false
    }
  }

  function editStoryEntity(item) {
    ports.storyEntityDraft.value = {
      id: item.id,
      entityType: item.entityType,
      canonicalName: item.canonicalName,
      profileJson: item.profileJson,
      status: item.status
    }
    if (item.entityType === 'item' && item.status === 'approved')
      ports.resourceLedgerDraft.value.resourceEntityId = item.id
  }

  async function saveStoryEntity() {
    const draft = ports.storyEntityDraft.value
    if (!draft.canonicalName.trim()) return ports.notice('请先填写资料对象名称')
    try {
      JSON.parse(draft.profileJson)
    } catch {
      return ports.notice('档案内容需要是有效 JSON')
    }
    const saved = await ports.guard(
      () =>
        ports.desktop.workspace.saveStoryEntity({
          ...(draft.id ? { id: draft.id } : {}),
          entityType: draft.entityType,
          canonicalName: draft.canonicalName,
          profileJson: draft.profileJson,
          status: draft.status
        }),
      `“${draft.canonicalName.trim()}”已保存为正式资料`
    )
    ports.storyEntityDraft.value = {
      id: '',
      entityType: 'character',
      canonicalName: '',
      profileJson: '{}',
      status: 'approved'
    }
    await loadStoryEntities()
    if (saved?.entityType === 'item' && saved.status === 'approved')
      ports.resourceLedgerDraft.value.resourceEntityId = saved.id
    await ports.refreshWorkflow()
  }

  async function saveStoryEntityRelation() {
    const draft = ports.storyRelationDraft.value
    if (!draft.subjectEntityId || !draft.objectEntityId || !draft.predicate.trim())
      return ports.notice('请完整选择关系双方并填写关系类型')
    await ports.guard(() => ports.desktop.workspace.saveStoryEntityRelation(ports.plainDto(draft)), '资料关系已保存')
    ports.storyRelationDraft.value = { subjectEntityId: '', predicate: '', objectEntityId: '', notes: '' }
    await loadStoryEntities()
  }

  async function appendResourceLedgerEntry() {
    const draft = ports.resourceLedgerDraft.value
    const delta = Number(draft.delta)
    if (!draft.resourceEntityId) return ports.notice('请先选择一个已确认的物品资料')
    if (!Number.isSafeInteger(delta) || delta === 0)
      return ports.notice('变化数量需要是非零整数；增加填正数，消耗填负数')
    const result = await ports.guard(
      () =>
        ports.desktop.workspace.appendResourceLedger({
          operationKey: crypto.randomUUID(),
          resourceEntityId: draft.resourceEntityId,
          delta,
          ...(draft.eventId.trim() ? { eventId: draft.eventId.trim() } : {}),
          ...(draft.note.trim() ? { note: draft.note.trim() } : {})
        }),
      '资源变化已记入正式账本'
    )
    if (!result) return
    ports.resourceLedgerDraft.value = { ...draft, delta: '', eventId: '', note: '' }
    await loadStoryEntities()
    if (result.balance.isNegative)
      ports.notice(`“${result.balance.resourceName}”当前为 ${result.balance.quantity}，已保留负数并标出提醒`)
  }

  return {
    loadCharacterAliases,
    editCharacterAliases,
    saveCharacterAliases,
    loadStoryEntities,
    editStoryEntity,
    saveStoryEntity,
    saveStoryEntityRelation,
    appendResourceLedgerEntry
  }
}
