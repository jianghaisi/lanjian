import { onBeforeUnmount, ref } from 'vue'
import type { LibraryOutlinePreview } from '../../../../contracts/library/library-outline-preview'
import { libraryClient } from '../services/library-client'

export function useLibraryOutline() {
  const preview = ref<LibraryOutlinePreview | null>(null)
  const loading = ref(false)
  const error = ref('')
  let version = 0
  async function load(path: string, offset = 0) {
    const request = ++version
    loading.value = true; error.value = ''; preview.value = null
    try {
      const result = await libraryClient.preview({ path, offset })
      if (request === version) preview.value = result
    } catch (reason) {
      if (request === version) error.value = typeof (reason as Error)?.message === 'string' ? (reason as Error).message : '目录暂时无法读取，请重试。'
    } finally { if (request === version) loading.value = false }
  }
  function clear() { version++; preview.value = null; loading.value = false; error.value = '' }
  onBeforeUnmount(clear)
  return { preview, loading, error, load, clear }
}
