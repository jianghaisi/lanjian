function inspect(text) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const sentences = text.split(/[。！？!?]+/).map(s => s.trim()).filter(Boolean);
  const longest = paragraphs.reduce((max, p) => Math.max(max, p.length), 0);
  return { paragraphs: paragraphs.length, sentences: sentences.length, longest };
}

export async function execute(toolId, input, ctx) {
  const summary = inspect(input.text);
  await ctx.interaction.request({
    question: { questions: [{ id: 'rhythm', prompt: '这段文字希望偏向哪种阅读节奏？', mode: 'single', required: true, options: [{ id: 'tense', label: '紧凑推进' }, { id: 'slow', label: '舒缓铺陈' }] }] },
    checkpoint: { summary }
  });
  return {};
}

export async function resume(toolId, checkpoint, answer, ctx) {
  const s = checkpoint.summary, choice = answer.answers[0];
  const direction = choice.chosenOptionIds.includes('tense') ? '紧凑推进' : choice.chosenOptionIds.includes('slow') ? '舒缓铺陈' : choice.customText || '保持现有节奏';
  return { text: `共 ${s.paragraphs} 段、${s.sentences} 个句段，最长段 ${s.longest} 字符。作者选择：${direction}。${s.longest > 300 ? '可以检查长段内是否混合了动作、解释与回忆，按转折拆段。' : '段落长度较为适中，可继续检查转折是否有足够铺垫。'}这是结构诊断建议，未修改正文。` };
}
