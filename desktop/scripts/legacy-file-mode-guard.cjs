const { lstatSync, realpathSync } = require('node:fs')
const { join, relative, isAbsolute } = require('node:path')
const { DatabaseSync } = require('node:sqlite')

function fail(code, message) { const error = new Error(message); error.code = code; throw error }

function contained(root, target) {
  const resolved = realpathSync(target)
  const path = relative(root, resolved)
  if (path === '..' || path.startsWith('..\\') || path.startsWith('../') || isAbsolute(path)) {
    fail('LEGACY_PATH_ESCAPE', '旧脚本检测到作品路径越界，已停止。请通过应用打开作品。')
  }
  return resolved
}

function assertLegacyFileMode(projectPath) {
  const root = realpathSync(projectPath)
  const metadata = contained(root, join(root, '.webnovel'))
  const file = join(metadata, 'workspace.sqlite')
  if (lstatSync(file, { throwIfNoEntry: false })) {
    let database
    try {
      database = new DatabaseSync(contained(root, file), { readOnly: true })
      const rows = database.prepare('SELECT storage_mode FROM projects').all()
      if (rows.length !== 1 || !['shadow', 'sqlite'].includes(rows[0].storage_mode)) throw new Error('UNKNOWN_STORAGE_MODE')
      if (rows[0].storage_mode === 'sqlite') {
        fail('SQLITE_FORMAL_REQUIRED', '此作品已使用 SQLite 正式数据，旧文件脚本已停止。请在应用中生成、采用、保存或测试模型；不要直接覆盖 Markdown/JSON 镜像。')
      }
    } catch (error) {
      if (error.code === 'SQLITE_FORMAL_REQUIRED' || error.code === 'LEGACY_PATH_ESCAPE') throw error
      fail('LEGACY_STORAGE_UNKNOWN', '无法确认作品的数据模式，旧脚本已停止；不会把异常数据库当成文件模式。请先在应用中检查项目数据。')
    } finally { database?.close() }
  }
  if (process.env.LANJIAN_LEGACY_OFFLINE !== '1') {
    fail('LEGACY_OFFLINE_REQUIRED', '此脚本仅供离线旧文件作品维护。请先关闭该作品的应用窗口，并显式设置 LANJIAN_LEGACY_OFFLINE=1；日常创作请使用应用。')
  }
}

module.exports = { assertLegacyFileMode }
