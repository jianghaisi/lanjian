import { decodeMarketQuery, type MarketRelease } from '@lanjian/writing-plugin-contracts'
import { decodeDraftRef } from '../../../../../contracts/writing-plugins/authoring'
import { objectSchema, textSchema } from '../../domain/schema'
import type { PluginEffectJournal } from '../../domain/plugin-run'
import { confirmedTool, idSchema, invalid, pluginTool, pretty, refSchema, result, type PluginWorkbenchServices } from './plugin-workbench-shared'

const releaseSummary = (release: MarketRelease) => ({ operationId: release.operationId, digest: release.digest, state: release.state, distribution: release.distribution, createdAt: release.createdAt, manualReview: release.manualReview, pluginId: release.manifest.id, name: release.manifest.name, version: release.manifest.version, description: release.manifest.description, categoryIds: release.manifest.categoryIds ?? [], tags: release.manifest.tags ?? [], capabilities: release.manifest.capabilities, toolCount: release.manifest.tools.length, contributionCount: release.manifest.contributions?.length ?? 0 })
export function pluginMarketTools(ports: PluginWorkbenchServices, journal: PluginEffectJournal) {
  return [
    pluginTool('search_plugin_market', '匿名查询真实插件市场或某个插件的公开版本。分类/标签多选按 AND 匹配，来源 all/official/community，分页沿用 nextOffset。只返回实际服务结果；没有市场配置时明确不可用。', 'read', 'plugins.read',
      objectSchema({ pluginId: idSchema, query: textSchema(200), categories: { type: 'array', maxItems: 16, items: textSchema(80, 1) }, tags: { type: 'array', maxItems: 12, items: textSchema(80, 1) }, source: { type: 'string', enum: ['all', 'official', 'community'], maxLength: 12 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, []), async (args, host) => {
        const query = decodeMarketQuery({ query: args.query ?? '', categories: args.categories ?? [], tags: args.tags ?? [], source: args.source ?? 'all', offset: args.offset ?? 0, limit: args.limit ?? 10 })
        const page = await host.hostCall(() => args.pluginId ? ports.market.versions(String(args.pluginId), query) : ports.market.catalog(query))
        return result({ releases: page.releases.map(releaseSummary), nextOffset: page.nextOffset })
      }),
    pluginTool('read_market_plugin', '读取搜索结果中确切 operationId 的公开插件详情与完整清单、声明工具、贡献、权限和包摘要。不会下载、安装或授予权限。', 'read', 'plugins.read', objectSchema({ operationId: textSchema(36, 36) }),
      async (args, host) => { const release = await host.hostCall(() => ports.market.release(String(args.operationId))); return result({ ...releaseSummary(release), manifest: release.manifest, upstream: release.upstream }) }),
    confirmedTool('publish_plugin', '读取真实草稿版本、实际文件和包摘要，请求作者确认后提交到市场。自动校验通过即公开，不另设人工待审。只能发布本地草稿；必须登录；不能接受模型提供批准参数。', refSchema, journal,
      async args => {
        const preview = await ports.market.preview(decodeDraftRef(args))
        return { prepared: { planId: preview.planId }, review: { title: `公开发布 ${preview.build.manifest.name} · ${preview.build.manifest.version}`, summary: '确认后上传下面列出的插件包与发布资料；自动校验通过即公开，其他作者可以下载。不会上传作品或模型凭据。', sections: [
          { label: '将公开的完整清单', content: pretty(preview.build.manifest) },
          { label: '实际上传文件与摘要', content: pretty(preview.build.files) },
          { label: '包摘要与上游引用', content: pretty({ digest: preview.request.digest, bytes: preview.request.bytes, upstream: preview.request.upstream }) }
        ] } }
      }, async (_args, prepared) => { const release = await ports.market.publish(String(prepared.planId)); return releaseSummary(release) }),
    confirmedTool('manage_plugin_publication', '请求作者确认查询后继续上传或下架本人发布的确切 operationId。retry 先查询原操作防止重复发布；withdraw 停止新下载，保留已安装版本。只处理服务确认属于本人的发布记录。',
      objectSchema({ operationId: textSchema(36, 36), action: { type: 'string', enum: ['retry', 'withdraw'], maxLength: 10 } }), journal,
      async args => {
        const original = await ports.market.publication(String(args.operationId))
        return { prepared: { digest: original.request.digest }, review: { title: `${args.action === 'retry' ? '查询后继续发布' : '下架公开版本'}：${original.request.manifest.name}`, summary: args.action === 'retry' ? '复用上次提交的确切包和发布操作；校验通过后可公开。' : '该版本将停止新的下载。本机安装和作者作品保留。', sections: [{ label: '确切发布版本与清单', content: pretty(original.request) }] } }
      }, async (args, prepared) => {
        const original = await ports.market.publication(String(args.operationId))
        if (original.request.digest !== prepared.digest) return invalid()
        const release = await (args.action === 'retry' ? ports.market.retry(String(args.operationId)) : ports.market.withdraw(String(args.operationId)))
        return releaseSummary(release)
      }),
    pluginTool('refresh_plugin_publication', '从市场重新核对本人某次发布操作的真实状态。不重新上传，也不会把 validating 当成已公开。', 'read', 'plugins.read', objectSchema({ operationId: textSchema(36, 36) }),
      async (args, host) => result(releaseSummary(await host.hostCall(() => ports.market.refresh(String(args.operationId)))))),
    confirmedTool('plugin_market_account', '请求作者确认打开系统浏览器登录插件市场，或退出市场账号。不读取或返回访问令牌、模型密钥。登录仍需作者在浏览器完成；浏览和下载无需登录。',
      objectSchema({ action: { type: 'string', enum: ['login', 'logout'], maxLength: 10 } }), journal,
      async args => {
        const status = await ports.market.status()
        if (!status.available) return result({ available: false, notice: '此发行版尚未连接公共市场。本地插件仍可使用。' })
        return { prepared: {}, review: { title: args.action === 'login' ? '登录插件市场' : '退出插件市场', summary: args.action === 'login' ? '将在系统浏览器打开已配置的市场身份服务；登录只用于发布和管理自己的公开版本。' : '退出当前市场账号并清除本机内存中的登录凭据，保留插件草稿和已安装版本。', sections: [] } }
      }, async args => { const status = await (args.action === 'login' ? ports.market.login() : ports.market.logout()); return { available: status.available, loginState: status.auth.state, notice: status.auth.state === 'waiting' ? '浏览器已打开，等待作者完成登录。' : '市场账号状态已更新。' } })
  ]
}
