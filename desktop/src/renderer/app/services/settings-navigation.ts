export const settingsSections = [
  { id: 'local-models', label: '本地模型商店', mark: '本', description: '在本机选用模型与分配写作任务', keywords: '本地 Qwen 千问 下载 安装 离线 商店' },
  { id: 'connection', label: '接口连接', mark: '联', description: '地址、密钥与真实连接测试', keywords: 'API 服务商 令牌' },
  { id: 'routing', label: '任务模型', mark: '任', description: '按创作任务分配模型与参数', keywords: 'GPT Gemini DeepSeek 豆包 温度 输出' },
  { id: 'context', label: '上下文预算', mark: '文', description: '控制每次 AI 任务携带的作品资料量', keywords: 'token 提示词 发送前确认' },
  { id: 'writing', label: '写作偏好', mark: '写', description: '正文展开方式与事实审校强度', keywords: '生成 事实 确认 审阅' },
  { id: 'story', label: '正式资料', mark: '设', description: '人物、地点、物品、组织与世界规则', keywords: '设定 实体' },
  { id: 'prompts', label: '题材提示词', mark: '词', description: '谋篇、章纲、正文与审校提示词', keywords: '模板 prompt' },
  { id: 'research', label: '联网采风', mark: '采', description: '公开网络资料搜索连接', keywords: '搜索 方舟 API' },
  { id: 'appearance', label: '外观与版式', mark: '界', description: '主题、工作区宽度与启动恢复', keywords: '主题 浅色 宣纸 墨夜 深色 边栏 助笔 开场 启动 恢复' },
  { id: 'companion', label: '写作伙伴', mark: '伴', description: '看板娘形态、动作与专注偏好', keywords: '精细 Q版 隐藏 眨眼 动画 鼠标 Live2D' },
  { id: 'trial', label: '试跑记录', mark: '测', description: '按章记录真实写作体验与成本', keywords: '耗时 满意度 负担' },
  { id: 'project', label: '项目数据', mark: '项', description: '备份、作品格式与迁移诊断', keywords: 'SQLite Markdown JSON 恢复 导出 镜像' },
  { id: 'about', label: '关于岚笺', mark: '岚', description: '版本、数据原则与能力边界', keywords: '版本 隐私 许可' }
] as const

export const settingsCategories = [
  { id: 'common', label: '常用', mark: '常', description: '外观与日常写作习惯', sections: ['appearance', 'companion'] },
  { id: 'ai', label: 'AI 与模型', mark: '模', description: '接口、模型和上下文', sections: ['local-models', 'connection', 'routing', 'context'] },
  { id: 'writing', label: '写作', mark: '写', description: '生成习惯与题材提示词', sections: ['writing', 'prompts'] },
  { id: 'data', label: '数据与备份', mark: '库', description: '本地作品、备份和试跑', sections: ['project', 'trial'] },
  { id: 'advanced', label: '高级', mark: '高', description: '联网采风与产品信息', sections: ['research', 'about'] }
] as const

export function categoryForSettingsSection(sectionId: string): typeof settingsCategories[number] {
  return settingsCategories.find((category) => (category.sections as readonly string[]).includes(sectionId)) || settingsCategories[0]
}

export function firstSettingsSection(categoryId: string): string {
  return settingsCategories.find((category) => category.id === categoryId)?.sections[0] || settingsCategories[0].sections[0]
}

export function searchSettingsSections(query: string, categoryId?: string) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  return settingsSections.filter((section) => {
    if (section.id === 'story') return false
    const category = categoryForSettingsSection(section.id)
    if (!normalized) return !categoryId || category.id === categoryId
    return `${section.label} ${section.description} ${section.keywords || ''}`.toLocaleLowerCase('zh-CN').includes(normalized)
  })
}
