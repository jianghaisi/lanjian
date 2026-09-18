// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryImportsActions(ports) {
  async function openTxtImport(entry = 'inside-work-item') {
    if (entry === 'create-from-files') {
      ports.txtImportEntry.value = entry
      ports.txtPreview.value = null
      ports.txtMaterialPreview.value = null
      ports.importManifest.value = null
      ports.importCreatedProject.value = null
      ports.manifestRoles.value = {}
      ports.manifestChapterSelections.value = {}
      ports.txtImport.value = {
        ownership: 'owned',
        creationMethod: 'mixed',
        destination: 'new',
        title: '',
        parentPath: '',
        genre: ports.current.value?.genre || '玄幻',
        externalConfirmed: false,
        selectedChapterIndexes: []
      }
      ports.showTxtImport.value = true
      return
    }
    const preview = await ports.guard(() => ports.desktop.imports.chooseText())
    if (!preview) return
    ports.txtImportEntry.value = entry
    ports.txtPreview.value = preview
    ports.txtMaterialPreview.value = null
    ports.importManifest.value = null
    ports.importCreatedProject.value = null
    ports.manifestRoles.value = {}
    ports.manifestChapterSelections.value = {}
    ports.txtImport.value = {
      ownership: 'owned',
      creationMethod: 'mixed',
      destination: 'new',
      title: preview.suggestedTitle,
      parentPath: '',
      genre: ports.current.value?.genre || '玄幻',
      externalConfirmed: false,
      selectedChapterIndexes: preview.chapters
        .filter((chapter) => chapter.selectedByDefault)
        .map((chapter) => chapter.sourceIndex)
    }
    ports.showTxtImport.value = true
  }

  async function addContinuationDocuments() {
    if (ports.busy.value) return
    const existing = ports.importManifest.value
    if (existing && typeof ports.desktop?.imports?.appendDocuments !== 'function') {
      ports.notice('多批文件接续需要重启岚笺后才能继续添加')
      return
    }
    if (!existing && typeof ports.desktop?.imports?.chooseDocuments !== 'function') {
      ports.notice('文件选择功能暂不可用，请完整退出并重新启动岚笺后再试')
      return
    }
    const manifest = existing
      ? await ports.guard(() => ports.desktop.imports.appendDocuments(existing.id))
      : await ports.guard(() => ports.desktop.imports.chooseDocuments())
    if (!manifest) return
    const existingRoles = ports.manifestRoles.value
    const existingSelections = ports.manifestChapterSelections.value
    const previousOrder = existing?.files.map((file) => file.token) || []
    const order = [
      ...previousOrder,
      ...manifest.files.map((file) => file.token).filter((token) => !previousOrder.includes(token))
    ]
    ports.importManifest.value = {
      ...manifest,
      files: [...manifest.files].sort((left, right) => order.indexOf(left.token) - order.indexOf(right.token))
    }
    ports.manifestRoles.value = Object.fromEntries(
      manifest.files.map((file) => [file.token, existingRoles[file.token] || ''])
    )
    ports.manifestChapterSelections.value = Object.fromEntries(
      manifest.files.map((file) => [
        file.token,
        existingSelections[file.token] ||
          file.chapters.filter((chapter) => chapter.selectedByDefault).map((chapter) => chapter.sourceIndex)
      ])
    )
    const selected =
      manifest.files.find((file) => file.token === ports.txtPreview.value?.token) ||
      manifest.files.find((file) => file.recommendedRole === 'manuscript') ||
      manifest.files[0]
    ports.txtPreview.value = selected || null
    if (!ports.txtImport.value.title.trim() && selected) ports.txtImport.value.title = selected.suggestedTitle
  }

  function moveManifestFile(token, direction) {
    const manifest = ports.importManifest.value
    if (!manifest || ports.busy.value) return
    const index = manifest.files.findIndex((file) => file.token === token)
    const destination = index + direction
    if (index < 0 || destination < 0 || destination >= manifest.files.length) return
    const files = [...manifest.files]
    ;[files[index], files[destination]] = [files[destination], files[index]]
    ports.importManifest.value = { ...manifest, files }
  }

  async function chooseTxtDestination() {
    ports.txtImport.value.parentPath =
      (await ports.desktop.projects.chooseDirectory()) || ports.txtImport.value.parentPath
  }

  async function commitTxtImport() {
    if (!ports.txtCanImport.value) return
    const form = ports.txtImport.value
    const preview = ports.txtPreview.value
    const createsWorkItemFromFiles = form.ownership === 'owned' && form.destination === 'new'
    const result = await ports.guard(async () => {
      if (createsWorkItemFromFiles && !ports.importCreatedProject.value) {
        if (!(await ports.prepareWorkItemTransition())) throw new Error('当前正文尚未保存，已留在原作品中')
        if (!ports.importModelsPreview.value) throw new Error('请先核对新书默认分配，或明确选择先手写建书。')
        const created = ports.partialImportCreation.value
          ? await ports.desktop.modelConnections.retryCreation({
              token: ports.importModelsPreview.value.token,
              operationId: ports.partialImportCreation.value.operationId
            })
          : await ports.desktop.modelConnections.createProject({
              token: ports.importModelsPreview.value.token,
              project: { parentPath: form.parentPath, name: form.title, genre: form.genre, mode: 'txt-import' }
            })
        if (created.status === 'partial') {
          ports.partialImportCreation.value = created
          throw new Error(created.message)
        }
        ports.partialImportCreation.value = null
        ports.importCreatedProject.value = created.project
        await ports.activateWorkItem(created.project, false)
      } else if (createsWorkItemFromFiles && ports.current.value?.path !== ports.importCreatedProject.value?.path) {
        await ports.activateWorkItem(ports.importCreatedProject.value, false)
      }
      const manifestId = ports.importManifest.value?.id
      const imported =
        createsWorkItemFromFiles && ports.importManifest.value
          ? await ports.desktop.imports
              .commitManifest({
                id: ports.importManifest.value.id,
                files: ports.importManifest.value.files.map((file) => {
                  const role = ports.manifestRoles.value[file.token]
                  if (role === 'skip') return { token: file.token, ownership: 'skip', title: file.suggestedTitle }
                  return {
                    token: file.token,
                    ownership: role === 'manuscript' ? 'owned' : role,
                    creationMethod: role === 'manuscript' ? form.creationMethod : undefined,
                    title: role === 'manuscript' && file.token === preview.token ? form.title : file.suggestedTitle,
                    selectedChapterIndexes:
                      role === 'manuscript' ? [...(ports.manifestChapterSelections.value[file.token] || [])] : undefined
                  }
                })
              })
              .then(({ results }) => ({
                ownership: 'owned',
                title: form.title,
                importedChapterIds: results.flatMap((item) => item.importedChapterIds),
                importedSourceIds: results.flatMap((item) => item.importedSourceIds || []),
                manifestId
              }))
          : await ports.desktop.imports.commitText({
              token: preview.token,
              ownership: form.ownership,
              creationMethod: form.ownership === 'owned' ? form.creationMethod : undefined,
              title: form.title,
              selectedChapterIndexes: form.ownership === 'owned' ? [...form.selectedChapterIndexes] : undefined
            })
      let importedMaterialCount = 0
      let materialImportWarning = ''
      if (createsWorkItemFromFiles && !ports.importManifest.value && ports.txtMaterialPreview.value) {
        try {
          const material = await ports.desktop.imports.commitText({
            token: ports.txtMaterialPreview.value.token,
            ownership: 'material',
            title: ports.txtMaterialPreview.value.suggestedTitle
          })
          importedMaterialCount = material.importedSourceIds?.length || 0
        } catch (error) {
          materialImportWarning = error?.message || '作品相关 TXT 导入失败'
        }
      }
      await ports.refreshProjects()
      await ports.loadWorkspace()
      return {
        ...imported,
        importedMaterialCount: importedMaterialCount + (imported.importedSourceIds?.length || 0),
        materialImportWarning
      }
    })
    ports.showTxtImport.value = false
    ports.txtPreview.value = null
    ports.txtMaterialPreview.value = null
    ports.importManifest.value = null
    ports.importCreatedProject.value = null
    ports.active.value = result.ownership === 'owned' ? 'desk' : 'research'
    if (createsWorkItemFromFiles && result.materialImportWarning) {
      ports.active.value = 'research'
      ports.notice(`正文已经安全建档，但作品相关 TXT 未导入：${result.materialImportWarning}。请在“素材”中重新导入`)
      return
    }
    if (createsWorkItemFromFiles && result.manifestId) {
      try {
        ports.continuationAnalysis.value = await ports.desktop.imports.generateContinuationAnalysis(result.manifestId)
        ports.continuationManifestId.value = ''
        ports.active.value = 'preparation'
        ports.preparationMode.value = 'continuation'
        ports.notice(
          `已建立作品并导入 ${result.importedChapterIds.length} 章；接续分析候选已生成，尚未写入正式设定或大纲`
        )
        return
      } catch {
        ports.active.value = 'preparation'
        ports.preparationMode.value = 'continuation'
        ports.continuationManifestId.value = result.manifestId
        ports.notice(`作品和文件已经安全建档；请检查模型设置，再生成接续分析候选`)
        return
      }
    }
    ports.notice(
      result.ownership === 'owned'
        ? `已导入 ${result.importedChapterIds.length} 章，未选片段仍保存在原始 TXT 归档中`
        : result.ownership === 'material'
          ? `作品资料已拆为 ${result.importedSourceIds?.length || 0} 张自备资料卡，尚未成为正式设定或事件`
          : '外部书籍已存入参考资料，未混入正文和模型上下文'
    )
  }

  return { openTxtImport, addContinuationDocuments, moveManifestFile, chooseTxtDestination, commitTxtImport }
}
