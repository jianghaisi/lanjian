import { decodeDeriveArgs, decodeDraftRef, decodeDraftSaveArgs, type PluginDraft } from '../../../../../contracts/writing-plugins/authoring'
import { objectSchema, textSchema } from '../../domain/schema'
import type { PluginEffectJournal } from '../../domain/plugin-run'
import { confirmedTool, digestSchema, idSchema, once, pluginTool, pretty, refSchema, result, revisionSchema, conflict, type PluginWorkbenchServices } from './plugin-workbench-shared'

export function draftSummary(draft: PluginDraft) {
  let name = '未完成的插件', parseable = false
  try { const manifest = JSON.parse(draft.manifestText); if (typeof manifest.name === 'string') name = manifest.name.slice(0, 100); parseable = true } catch { /* An invalid saved draft remains readable and repairable. */ }
  return { id: draft.id, pluginId: draft.pluginId, revision: draft.revision, name, updatedAt: draft.updatedAt, parseable, upstream: draft.upstream }
}

export function pluginDraftTools(ports: PluginWorkbenchServices, journal: PluginEffectJournal) {
  return [
    pluginTool('import_plugin_package', '打开系统窗口，由作者选择本地 ZIP 插件包，直接复制为可编辑的个人草稿。分配新身份并保留上游来源，无需先安装；不执行、授权或公开。取消不创建草稿，不接受模型传入路径。', 'interaction', 'plugins.drafts', objectSchema({}), async (args, host) => {
      return result(await once(journal, 'import-package', args, host, async () => {
        const draft = await ports.authoring.importPackage(() => host.hostCall(async () => {}))
        return draft ? draftSummary(draft) : { status: 'cancelled' }
      }))
    }),
    confirmedTool('export_plugin_draft', '将本机草稿导出为可离线分享和安装的 ZIP 插件包。先核对真实清单、文件和摘要，作者确认后在系统窗口选择保存位置。取消不导出；不接受路径或批准字段。导出冻结版本，不安装、授权或公开。', refSchema, journal,
      async args => {
        const build = await ports.authoring.validate(decodeDraftRef(args))
        return { prepared: { digest: build.digest }, review: { title: `导出插件包 · ${build.manifest.name} ${build.manifest.version}`, summary: '确认后选择 ZIP 保存位置。其他作者可通过“安装插件包”使用这个包，无需公共市场。导出后修改内容需要新版本号。', sections: [
          { label: '完整插件清单', content: pretty(build.manifest) },
          { label: '实际文件与摘要', content: pretty(build.files) },
          { label: '插件包摘要', content: build.digest }
        ] } }
      }, async (args, prepared, host) => {
        const exported = await ports.authoring.export({ ...decodeDraftRef(args), digest: String(prepared.digest) }, () => host.hostCall(async () => {}))
        return exported ? { status: 'exported', ...exported } : { status: 'cancelled' }
      }),
    pluginTool('read_plugin_draft', '读取本机插件草稿清单或源码。id 来自 list_plugins；省略 file 读取 manifestText，指定 file 只读取草稿实际声明的文件。按 offset/limit 分段，nextOffset=-1 表示结束；不访问任意磁盘路径。', 'read', 'plugins.read',
      objectSchema({ id: textSchema(36, 36), file: textSchema(240, 1), offset: { type: 'integer', minimum: 0, maximum: 3000000 }, limit: { type: 'integer', minimum: 1, maximum: 30000 } }, ['id']), async (args, host) => {
        const draft = (await host.hostCall(() => ports.authoring.list())).find(d => d.id === args.id)
        if (!draft) return conflict()
        const content = args.file === undefined ? draft.manifestText : draft.files.find(f => f.path === args.file)?.content
        if (content === undefined) return conflict()
        const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20000), end = Math.min(content.length, offset + limit)
        return result({ ...draftSummary(draft), file: args.file ?? 'lanjian-plugin.json', content: content.slice(offset, end), totalCharacters: content.length, nextOffset: end < content.length ? end : -1, files: draft.files.map(f => ({ path: f.path, characters: f.content.length })) })
      }),
    pluginTool('create_plugin_draft', '从 context 题材/文风、workflow 交互流程或 code 新工具代码模板创建一个本地个人草稿。返回真实 ID/版本；随后 read_plugin_draft 和 save_plugin_draft 编辑。不会安装、执行或公开。', 'derive', 'plugins.drafts',
      objectSchema({ template: { type: 'string', enum: ['context', 'workflow', 'code'], maxLength: 10 } }), async (args, host) => result(await once(journal, 'create', args, host, async () => draftSummary(await ports.authoring.create(args.template as 'context' | 'workflow' | 'code'))))),
    pluginTool('save_plugin_draft', '保存本地插件草稿的完整清单和源码文件集合，必须使用刚读取的 id/revision 并保留 pluginId。并发修改冲突时重新读取；不会安装、执行、启用或公开。manifestText 是完整 JSON，files 是全部源码文件；单次输入最多128KiB，大文件用界面编辑。', 'derive', 'plugins.drafts',
      objectSchema({ id: textSchema(36, 36), revision: { ...revisionSchema, minimum: 1 }, manifestText: textSchema(60000), files: { type: 'array', maxItems: 127, items: objectSchema({ path: textSchema(240, 1), content: textSchema(60000) }) } }), async (args, host) => {
        const input = decodeDraftSaveArgs([args])[0]
        return result(await once(journal, 'save', args, host, async () => draftSummary(await ports.authoring.save(input))))
      }),
    pluginTool('build_plugin_draft', '校验或构建本机插件草稿。validate 只校验；build 冻结此版本的不可变插件包。返回清单、实际文件及摘要；构建不安装、不执行、不公开，修改已构建内容必须增加版本号。', 'derive', 'plugins.drafts',
      objectSchema({ id: textSchema(36, 36), revision: { ...revisionSchema, minimum: 1 }, action: { type: 'string', enum: ['validate', 'build'], maxLength: 8 } }), async (args, host) => {
        const ref = decodeDraftRef({ id: args.id, revision: args.revision })
        if (args.action === 'build') await once(journal, 'build', args, host, async () => { const built = await ports.authoring.build(ref); return { draftId: built.draftId, revision: built.revision, digest: built.digest } })
        return result(await host.hostCall(() => ports.authoring.validate(ref)))
      }),
    pluginTool('derive_plugin_draft', '从确切 pluginId/digest 复制个人草稿，保留上游并分配新身份。source=bundled 从官方本地库复制，无需安装或服务器；省略 source 从已安装插件派生。个人副本不继承官方身份。', 'derive', 'plugins.drafts',
      objectSchema({ pluginId: idSchema, digest: digestSchema, source: { type: 'string', enum: ['installed', 'bundled'], maxLength: 10 } }, ['pluginId', 'digest']), async (args, host) => {
        const input = decodeDeriveArgs([{ pluginId: args.pluginId, digest: args.digest }])[0]
        return result(await once(journal, 'derive', args, host, async () => draftSummary(await (args.source === 'bundled' ? ports.bundled.derive(input) : ports.authoring.derive(input.pluginId, input.digest)))))
      }),
    pluginTool('import_plugin_source', '为指定代码插件草稿打开系统文件选择器，由作者选择已编译 JavaScript 导入；取消不修改草稿。不接受模型提供文件路径，不运行源码。', 'interaction', 'plugins.drafts', refSchema, async (args, host) => {
      const ref = decodeDraftRef(args)
      return result(await once(journal, 'import', args, host, async () => { const draft = await ports.authoring.importSource(ref); return draft ? draftSummary(draft) : { status: 'cancelled' } }))
    })
  ]
}
