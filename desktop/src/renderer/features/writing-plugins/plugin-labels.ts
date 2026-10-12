/** Author-facing labels shared by browsing and installation review. */
export const capabilityLabels: Record<string, string> = {
  'book.read': '读取作品背景与素材',
  'planning.read': '读取已保存的大纲',
  'manuscript.read': '读取正文',
  'planning.candidate': '准备大纲候选',
  'manuscript.candidate': '准备正文候选',
  'model.generate': '调用作品模型（可能产生费用）',
  'author.ask': '向作者提问',
  'assets.read': '读取插件附带的资料'
}
export const stageLabels: Record<string, string> = {
  assistant: '助笔对话', worldbuilding: '世界设定', planning: '大纲规划', writing: '正文创作', review: '审校'
}
export const effectLabels: Record<string, string> = {
  read: '读取资料', derive: '分析与整理', candidate: '生成待确认内容', interaction: '向作者提问'
}
