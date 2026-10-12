import { http } from '../api/http'

function chooseFiles(multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt,.md,.docx'; input.multiple = multiple
    input.addEventListener('change', () => { const files = Array.from(input.files ?? []); input.remove(); resolve(files) }, { once: true })
    input.addEventListener('cancel', () => { input.remove(); resolve([]) }, { once: true })
    input.hidden = true; document.body.append(input); input.click()
  })
}
export async function importDocuments(book: string, mode: 'single' | 'multiple' | 'append', manifestId?: string) {
  const files = await chooseFiles(mode !== 'single')
  if (!files.length) return null
  if (files.length > 20 || files.some(file => file.size > 4 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('一次最多导入 20 个文件，单文件不超过 4 MB，总计不超过 8 MB。')
  const data = await Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return { name: file.name, base64: btoa(binary) }
  }))
  return http.request(`/api/books/${book}/desktop/import-files`, 'POST', { files: data, mode, ...(manifestId ? { manifestId } : {}) })
}
export async function exportManuscript(book: string, selection?: unknown) {
  const file = await http.request(`/api/books/${book}/desktop/export-manuscript`, 'POST', selection === undefined ? {} : { selection }) as { filename: string; content: string; chapterCount: number; characterCount: number }
  const url = URL.createObjectURL(new Blob([file.content], { type: 'text/markdown;charset=utf-8' })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = file.filename; document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return { format: 'markdown', filePath: file.filename, chapterCount: file.chapterCount, characterCount: file.characterCount }
}
