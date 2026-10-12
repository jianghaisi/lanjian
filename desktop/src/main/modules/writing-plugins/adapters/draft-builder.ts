import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { validatePluginManifest, validatePluginRecipe, type PluginRecipe } from '@lanjian/writing-plugin-contracts'
import { decodePluginDraft, decodeDraftContent } from '../../../../contracts/writing-plugins/authoring'
import type { PluginDraft, DraftContent } from '../../../../contracts/writing-plugins/authoring'
import type { BuiltDraft } from '../domain/authoring'
import { AppError } from '../../../core/errors/app-error'
import { readPluginPackage } from './package-reader'
import { validateDraftWorkflowQuestions } from '../domain/draft-workflow-validation'

/** Construction is data-only. The production ZIP reader verifies every generated
 * byte; neither JS nor declarative tools execute on the authoring host. */
export async function buildPluginDraft(input: PluginDraft): Promise<BuiltDraft> {
  let built: BuiltDraft, recipe: PluginRecipe | undefined
  try {
    const draft = decodePluginDraft(input), manifest = validatePluginManifest(JSON.parse(draft.manifestText))
    if (manifest.id !== draft.pluginId) throw new Error('Identity mismatch')
    const { bytes, pkg } = await buildPluginContent({ manifestText: draft.manifestText, files: draft.files })
    if (pkg.manifest.runtime === 'declarative') recipe = validatePluginRecipe(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pkg.files.get(pkg.manifest.entry))), pkg.manifest)
    built = { bytes, view: { draftId: draft.id, revision: draft.revision, manifest: pkg.manifest, digest: pkg.digest, files: [...pkg.files].map(([path, content]) => ({ path, bytes: content.length, digest: createHash('sha256').update(content).digest('hex') })) } }
  } catch (cause) { throw new AppError('VALIDATION_ERROR', '插件尚不能构建：请检查清单、固定身份、声明文件、贡献和工具格式。草稿仍可保存。', { recoverable: true, cause }) }
  // Keep the bounded author-facing diagnostic instead of wrapping it in the
  // generic package error. No immutable build or install plan exists yet.
  if (recipe) validateDraftWorkflowQuestions(recipe)
  for (const [index, contribution] of (built.view.manifest.contributions ?? []).entries()) {
    if ('recipe' in contribution) validateDraftWorkflowQuestions(contribution.recipe, index)
  }
  return built
}

/** Common deterministic packaging only; personal identity is checked above and
 * bundled identity comes exclusively from release-owned content. */
export async function buildPluginContent(input: DraftContent) {
  const draft = decodeDraftContent(input), manifest = validatePluginManifest(JSON.parse(draft.manifestText))
  const paths = [manifest.entry, ...manifest.assets ?? []]
  if (paths.length !== draft.files.length || paths.some(p => !draft.files.some(f => f.path === p))) throw new Error('Undeclared or missing file')
  const zip = new JSZip(), date = new Date('2000-01-01T00:00:00Z')
  zip.file('lanjian-plugin.json', JSON.stringify(manifest, null, 2) + '\n', { date })
  for (const file of [...draft.files].sort((a, b) => a.path.localeCompare(b.path, 'en'))) zip.file(file.path, file.content, { date, createFolders: false })
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' }), pkg = await readPluginPackage(bytes)
  return { bytes, pkg }
}
