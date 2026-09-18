import { ref } from 'vue'
import type { OutlineUpdateResult, SqliteStorageStatus } from '../../../../contracts/index'
import type { WorkspaceIdentity, WorkspaceRequestGuard } from '../../../../contracts/library/workspace-request-guard'

type Receipt = Pick<OutlineUpdateResult, 'storageMode' | 'mirrorStatus'>

/** Presentation only. A missing/failed status read is never evidence of file mode. */
export function createOutlineStorageFeedback(
  read: () => Promise<SqliteStorageStatus>,
  current: () => WorkspaceIdentity | null,
  requests: WorkspaceRequestGuard
) {
  const status = ref<SqliteStorageStatus | null>(null)
  const receipts = ref<Record<string, Receipt>>({})
  const loading = ref(false)
  const error = ref(false)
  let generation = 0
  function reset() { generation += 1; status.value = null; receipts.value = {}; loading.value = false; error.value = false }
  async function refresh() {
    const identity = current(); if (!identity) return
    const request = requests.capture(identity), ticket = ++generation
    const valid = () => ticket === generation && requests.isCurrent(request, current())
    loading.value = true; error.value = false
    try {
      const result = await read()
      if (!valid()) return
      status.value = result
      receipts.value = {}
    } catch {
      if (valid()) { status.value = null; error.value = true }
    } finally { if (valid()) loading.value = false }
  }
  function record(key: string, receipt: Receipt) {
    generation += 1; loading.value = false
    const previousMode = status.value?.outlineStorageMode ?? Object.values(receipts.value).find(item => item.storageMode)?.storageMode
    if (receipt.storageMode && previousMode && previousMode !== receipt.storageMode) {
      status.value = null; receipts.value = {}
    }
    receipts.value = { ...receipts.value, [key]: { storageMode: receipt.storageMode, mirrorStatus: receipt.mirrorStatus } }
  }
  function describe(key: string): { text: string; warning: boolean } {
    const receipt = receipts.value[key]
    const mode = receipt?.storageMode ?? status.value?.outlineStorageMode
    if (!mode) return { text: loading.value ? '正在核对存储状态…' : '存储状态待确认', warning: !loading.value }
    if (status.value?.textAuthority === 'files-v1') return receipt && receipt.mirrorStatus !== 'synced'
      ? { text: '稿件文件需核对，原稿与历史均已保留', warning: true }
      : { text: '已保存为 Markdown · 数据库仅记录版本与关系', warning: false }
    if (mode === 'files') return { text: '已保存为 Markdown', warning: false }
    if (receipt) {
      if (receipt.mirrorStatus === 'synced') return { text: '已存入 SQLite · Markdown 已同步', warning: false }
      return { text: receipt.mirrorStatus ? '已存入 SQLite · 当前 Markdown 镜像待处理' : '已存入 SQLite · Markdown 同步状态待确认', warning: true }
    }
    if (status.value?.outlineStorageMode === 'sqlite' && status.value.outlinePendingMirrors + status.value.outlineConflictMirrors + status.value.outlineFailedMirrors > 0) {
      return { text: '已存入 SQLite · Markdown 镜像待处理', warning: true }
    }
    if (status.value?.outlineStorageMode === 'sqlite') return { text: '已存入 SQLite · Markdown 已同步', warning: false }
    return { text: '已存入 SQLite · Markdown 同步状态待确认', warning: true }
  }
  return { loading, error, refresh, reset, record, describe }
}
