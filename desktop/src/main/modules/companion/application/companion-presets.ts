/** Deterministic companionship, never advertised as model understanding or a tool result. */
export type CompanionPresetContext = { now: Date; work?: { title: string; chapter: string | null }; page?: '我的作品' | '写作工作台' }
const tapLines = ['我在呢。慢慢写，我们一起把故事讲好。', '收到你的呼唤啦。要继续写下一个画面吗？', '灵感来了就记下来，不必急着一次写完。', '休息一下也没关系，我会在这里陪着你。']
export function companionTapReply(index: number): string { return tapLines[index % tapLines.length]! }
export function companionPresetReply(input: string, { now, work, page = '我的作品' }: CompanionPresetContext): string {
  const question = input.trim()
  if (/(几点|时间|日期|星期|几号)/u.test(question)) return `现在是 ${now.toLocaleString('zh-CN', { hour12: false })}，${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now)}。`
  if (/(继续创作|哪[本部个].*作品|书名|写哪|什么作品|章节)/u.test(question)) return work ? `继续创作的是《${work.title.slice(0, 48)}》。${work.chapter ? `上次章节：${work.chapter.slice(0, 48)}。` : '这部作品尚未提供最近章节。'}` : '目前没有可以继续创作的作品。'
  if (/(页面|在哪)/u.test(question)) return page === '写作工作台' ? '你正在写作工作台，我在桌面上陪你继续创作。' : '这里是“我的作品”，可以选择作品继续创作。'
  if (/(保存|成功|失败|完成|删除|导入)/u.test(question)) return '我没有这次操作的确认结果，请以界面显示的实际状态为准。'
  if (/^(你好|您好|嗨|在吗|谢谢|晚安)[呀啊呢！!。？?]*$/u.test(question)) return question.startsWith('晚安') ? '晚安。灵感可以留给明天，今天也辛苦啦。' : '我在呢。愿今天也有值得写下的故事。'
  return '现在是预设陪伴模式，可以查询时间、当前页面和继续创作的作品。自由问答需要在右上角设置中开启文字模型。'
}
