// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryStorageActions(ports) {
  async function migrateProject() {
    if (!ports.migrationPreview.value?.required || !ports.migrationPreview.value.canMigrate) return
    const accepted = window.confirm(
      `将项目数据从版本 ${ports.migrationPreview.value.currentVersion} 升级到版本 ${ports.migrationPreview.value.targetVersion}。升级前会原样备份项目清单，不会改写正文。是否继续？`
    )
    if (!accepted) return
    await ports.flushChapterSave()
    const result = await ports.guard(() => ports.desktop.projects.migrate(), '项目数据已安全升级，原清单已备份')
    ports.migrationPreview.value = result
  }

  async function openSqliteShadowMigration() {
    await ports.flushChapterSave()
    ports.sqliteShadowResult.value = null
    ports.sqliteShadowPreview.value = await ports.guard(
      () => ports.desktop.projects.previewSqliteShadowMigration(),
      '已完成只读核对；尚未建立数据库'
    )
  }

  function closeSqliteShadowMigration() {
    ports.sqliteShadowPreview.value = null
    ports.sqliteShadowResult.value = null
  }

  async function confirmSqliteShadowMigration() {
    const token = ports.sqliteShadowPreview.value?.token
    if (!token || !ports.sqliteShadowPreview.value.canImport) return
    ports.sqliteShadowResult.value = await ports.guard(
      () => ports.desktop.projects.importSqliteShadowMigration(token),
      'SQLite 影子副本已建立并校验；原稿没有改动'
    )
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
  }

  async function openSqliteActivation() {
    await ports.flushChapterSave()
    ports.sqliteActivationResult.value = null
    ports.sqliteActivationPreview.value = await ports.guard(
      () => ports.desktop.projects.previewSqliteActivation(),
      '已完成正式切换核对；尚未切换保存方式'
    )
  }

  function closeSqliteActivation() {
    ports.sqliteActivationPreview.value = null
    ports.sqliteActivationResult.value = null
  }

  async function confirmSqliteActivation() {
    const token = ports.sqliteActivationPreview.value?.token
    if (!token || !ports.sqliteActivationPreview.value.canActivate) return
    ports.sqliteActivationResult.value = await ports.guard(
      () => ports.desktop.projects.activateSqliteStorage(token),
      '已切换为 SQLite 正式保存，Markdown 镜像保持同步'
    )
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
    await ports.loadWorkspace()
  }

  async function retrySqliteMirrors() {
    await ports.guard(() => ports.desktop.projects.retrySqliteMirrors(), '已重新核对可读镜像')
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
    await ports.loadWorkspace()
  }

  async function rebuildReadableMirrors() {
    await ports.flushChapterSave()
    const result = await ports.guard(() => ports.desktop.projects.rebuildReadableMirrors())
    if (!result) return
    if (result.conflicts || result.failed) {
      ports.notice(
        `已核对 ${result.checked} 项：重建 ${result.recreated} 项，${result.conflicts} 项有外部修改，${result.failed} 项写入失败；原文件均未覆盖`
      )
    } else {
      ports.notice(`可读副本已核对：重建 ${result.recreated} 项，${result.upToDate} 项原本完整`)
    }
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
    await ports.loadWorkspace()
  }

  async function rollbackSqliteStorage() {
    if (
      !window.confirm(
        '岚笺会先逐章核对 Markdown 和章节顺序；全部与 SQLite 一致后，才会退回文件保存。SQLite 数据库会保留为影子副本。是否继续？'
      )
    )
      return
    await ports.flushChapterSave()
    await ports.guard(
      () => ports.desktop.projects.rollbackSqliteStorage(),
      '已安全退回 Markdown 文件保存；SQLite 影子副本仍保留'
    )
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
    await ports.loadWorkspace()
  }

  async function createWorkspaceBackup() {
    await ports.flushChapterSave()
    const result = await ports.guard(() => ports.desktop.projects.createWorkspaceBackup())
    if (!result) return
    ports.workspaceBackupResult.value = result
    ports.notice(`《${result.projectName}》备份已完成并校验`)
  }

  async function exportManuscript() {
    await ports.flushChapterSave()
    const result = await ports.guard(() => ports.desktop.projects.exportManuscript())
    if (!result) return
    ports.notice(`整书阅读稿已导出：${result.chapterCount} 章`)
  }

  return {
    migrateProject,
    openSqliteShadowMigration,
    closeSqliteShadowMigration,
    confirmSqliteShadowMigration,
    openSqliteActivation,
    closeSqliteActivation,
    confirmSqliteActivation,
    retrySqliteMirrors,
    rebuildReadableMirrors,
    rollbackSqliteStorage,
    createWorkspaceBackup,
    exportManuscript
  }
}
