# 岚笺写作插件 SDK v1

本目录记录 JavaScript 执行接口。管理入口位于作品的“设置 → 写作 → 写作插件”，支持本地 ZIP 安装、显式授权、本书选择、更新回退与卸载；另有使用同一 SDK 的有限声明式配置。安装步骤、示例打包与声明式语法见 [使用与编写写作插件](../../docs/WRITING-PLUGINS.md)。市场分发仍属于后续工作包。SDK 借鉴 DSH 的工具插件与交互生命周期分离，不兼容 DSH 插件包格式。

## 包与入口

本地 ZIP 根目录包含 `lanjian-plugin.json` 和预打包 ES 模块，例如 `main.js`。清单契约唯一来源是 `packages/writing-plugin-contracts/src/manifest.ts`：声明 `apiVersion: 1`、非 `builtin.*` 的 id、三段版本、名称、描述、`runtime: "quickjs-js"`、入口、能力、工具及可选只读 assets。每个工具需要 id、描述、effect、能力、输入和输出 object schema；schema 不允许额外字段。工具能力必须包含于插件能力。

TypeScript 在开发端编译；包内不安装 npm 依赖、不运行安装脚本，也不支持运行时 import。入口导出：

```js
export async function execute(toolId, input, ctx) {
  const source = await ctx.book.read({ kind: 'manuscript', chapterId: input.chapterId });
  const lengths = source.content.split(/[。！？]/u).filter(Boolean).map(s => s.length);
  return { count: lengths.length, longest: Math.max(0, ...lengths) };
}
```

这个工具的输入 schema 须声明 chapterId；输出声明 count/longest；声明 `manuscript.read` 能力即可。算法在独立进程内的 QuickJS 执行，不获得 Node、网络、文件或密钥访问。`index.d.ts` 可用于插件开发时的类型检查。

## SDK 能力

| 方法 | 请求 | 能力 |
| --- | --- | --- |
| book.read | kind=context / materials | book.read |
| book.read | kind=outline, key | planning.read |
| book.read | kind=manuscript, chapterId | manuscript.read |
| model.generate | instruction, 可选 draft | model.generate |
| candidate.prepare | kind=planning, key, input={} | planning.candidate |
| candidate.prepare | kind=expand, key, input={parentKey, expectedRevision, count, instruction} | planning.read + planning.candidate |
| candidate.prepare | kind=manuscript, key, input={chapterId, expectedRevision, instruction} | manuscript.read + manuscript.candidate |
| interaction.request | question, checkpoint | author.ask |
| assets.readText | 清单中的确切 path | assets.read |

每次调用同时核对工具声明、安装授权、原书选择及父任务能力。`model.generate` 使用原书冻结的模型配置与发送门禁，并注入境界和固定系统模板；返回普通建议。它不接收 model、URL、API key 或 bookId 参数。`book.read` 读取保存的数据，不能替代尚未保存的编辑器草稿。

候选方法只用于 `effect: "candidate"` 的工具，进入既有谋篇、拆纲或完整正文任务。返回的是实际 taskId/status/notice，不代表候选已完成，更不代表已采用。拆纲/正文请求必须携带读取时的 expectedRevision；过期版本会失败，不能绕过总纲→时间线→章纲→正文等原业务前置条件。

## 作者回答与副作用

```js
export async function execute(toolId, input, ctx) {
  await ctx.interaction.request({
    question: { questions: [{ id: 'tone', prompt: '选择方向', mode: 'single', required: true,
      options: [{ id: 'warm', label: '温暖' }, { id: 'dark', label: '悬疑' }] }] },
    checkpoint: { chapterId: input.chapterId }
  });
  return {}; // host 保存问题与 checkpoint，并释放虚拟机。
}
export async function resume(toolId, checkpoint, answer, ctx) {
  return { chosen: answer.answers[0].chosenOptionIds, chapterId: checkpoint.chapterId };
}
```

提问后不能继续调用 SDK；请 await 请求后立即返回。checkpoint 只保存纯 JSON 数据，不保存栈、函数、句柄或权限。恢复时使用锁定版本，在新 VM 调用 `resume`；原输入中需要延续的值应放入 checkpoint。再次请求交互会产生新问题；同一原工具调用仅在最终完成时结算一次。作者未提交时不会执行预选项。

candidate.prepare 的 key 是工具作者指定、1–100 字符的字母数字/下划线/短横线步骤名。在同一原工具调用及其恢复过程中，同 key + 同请求返回已持久化的真实回执；同 key 改参数会冲突。不同候选步骤使用不同 key。主程序先写意图再调用领域服务；如果写入结果中断或结果不明，会停止并保留记录，不自动重做。不要通过更换 key 规避未知结果核对。

插件更新仅影响新任务；已有任务保持旧版本。停用、撤销原书选择或卸载会取消关联任务和待答问题。应用重启后需要作者显式恢复，不能自动重新执行未核实的操作。

## 资源与验证范围

输入 128 KiB、输出 1 MiB、checkpoint 64 KiB；每段父任务最多 24 个模型步骤和 96 次工具/SDK 调用，包含 SDK 嵌套业务调用。包压缩 10 MiB、展开 30 MiB/128 文件、入口 2 MiB。单次 VM 调用总时限 120 秒，同步片段 5 秒；一次作者等待结束该次调用。具体常量以共享 limits.ts 为准。

运行记录、候选及 checkpoint 都不构成正式书稿权威。SDK 单元测试使用真实 QuickJS 与隔离包存储；原生 smoke 使用实际 Electron 主进程、预加载桥、子进程和领域任务，以及本机假模型服务，不调用外部模型、不接触作者书稿。
