import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { record, text, uuid } from '@lanjian/hosted-contracts'
import { decodeManuscriptExportArgs } from '../../../../desktop/src/contracts/manuscript/ipc'
import { buildManuscriptExport, safeExportFileName } from '../../../../desktop/src/main/modules/manuscript/application/manuscript-export-service'
import { projectTargetPath } from '../../../../desktop/src/main/platform/storage/project-path'
import { desktopPrivateArgs, desktopPublicValue } from '../writing/desktop-values.ts'
import { assertTenantSpace } from '../files/quota.ts'
import { readSite } from '../admin/site-store.ts'
import type { BookRuntimes } from '../writing/book-runtime.ts'
import type { WritingRouteContext } from './writing-routes.ts'
import { fail } from './errors.ts'
import { assertDocumentUpload } from '../files/document-upload.ts'

export function registerDesktopFileRoutes(ctx: WritingRouteContext, runtimes: BookRuntimes) {
  ctx.app.post<{ Params: { bookId: string } }>('/api/books/:bookId/desktop/import-files', { bodyLimit: 12 * 1024 * 1024 }, async request => {
    const owner = ctx.write(request).user.id, id = uuid(request.params.bookId), input = record(request.body, ['files', 'mode', 'manifestId'])
    ctx.rate(`desktop-files:${owner}`, 30)
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 20 || !['single', 'multiple', 'append'].includes(String(input.mode))) fail('invalid-request')
    let total = 0
    const files = input.files.map(raw => {
      const p = record(raw, ['name', 'base64']), name = text(p.name, 120)
      if (!/^[^<>:"/\\|?*]+\.(txt|md|docx)$/iu.test(name) || typeof p.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.base64)) fail('invalid-request')
      const bytes = Buffer.from(p.base64, 'base64'); total += bytes.length
      if (bytes.toString('base64') !== p.base64 || !bytes.length || bytes.length > 4 * 1024 * 1024 || total > 8 * 1024 * 1024) fail('request-too-large')
      assertDocumentUpload(name, bytes)
      return { name, bytes }
    })
    if (input.mode === 'single' && files.length !== 1) fail('invalid-request')
    if (new Set(files.map(f => f.name.toLocaleLowerCase())).size !== files.length) fail('invalid-request')
    return runtimes.mutations.run(id, () => runtimes.run(owner, id, async r => {
      await assertTenantSpace(ctx.db.root, owner, id, total * 3 + 1024 * 1024, readSite(ctx.db).limits)
      const parent = await projectTargetPath(r.root, join(r.root, '.webnovel', 'hosted-uploads'))
      await mkdir(parent, { recursive: true, mode: 0o700 })
      const directory = await mkdtemp(join(parent, 'documents-')), paths: string[] = []
      try {
        for (const file of files) { const path = join(directory, file.name); await writeFile(path, file.bytes, { flag: 'wx', mode: 0o600 }); paths.push(path) }
        const preview = input.mode === 'single' ? await r.imports.previewFile(paths[0]!)
          : input.mode === 'append' ? await r.imports.appendFiles(uuid(input.manifestId), paths) : await r.imports.previewFiles(paths)
        return desktopPublicValue(preview, r.root, id)
      } finally { for (const path of paths) await unlink(path).catch(() => undefined); await rmdir(directory).catch(() => undefined) }
    }))
  })
  ctx.app.post<{ Params: { bookId: string } }>('/api/books/:bookId/desktop/export-manuscript', async request => {
    const owner = ctx.write(request).user.id, id = uuid(request.params.bookId), input = record(request.body, ['selection'])
    ctx.rate(`desktop-files:${owner}`, 30)
    return runtimes.mutations.run(id, () => runtimes.run(owner, id, async r => {
      const args = desktopPrivateArgs(input.selection === undefined ? [] : [input.selection], r.root, id)
      const [selection] = decodeManuscriptExportArgs(args), snapshot = await r.exports.prepare(selection)
      const content = buildManuscriptExport(snapshot.title, snapshot.chapters, 'markdown')
      return { filename: `${safeExportFileName(snapshot.title)}.md`, content, chapterCount: snapshot.chapters.length, characterCount: Array.from(content).length }
    }))
  })
}
