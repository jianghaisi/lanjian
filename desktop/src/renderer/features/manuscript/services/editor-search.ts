import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { search } from '@codemirror/search'

export const editorSearchPhrases = {
  Find: '查找内容', Replace: '替换为', next: '下一处', previous: '上一处', all: '选中全部',
  'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配',
  replace: '替换这一处', 'replace all': '全部替换', close: '关闭查找',
  'current match': '当前匹配', 'on line': '所在行',
  'replaced match on line $': '已替换第 $ 行的匹配', 'replaced $ matches': '已替换 $ 处',
  'Go to line': '跳转到行', go: '跳转'
} satisfies Record<string, string>

export function editorSearchExtensions() {
  return [
    EditorState.phrases.of(editorSearchPhrases),
    search({ top: true }),
    EditorView.theme({
      '.cm-panel.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '10px 48px 10px 12px', borderBottom: '1px solid var(--line)', lineHeight: '1.5' },
      '.cm-search br': { flexBasis: '100%', height: '0' },
      '.cm-search .cm-textfield': { flex: '1 1 160px', width: '160px', maxWidth: '260px', minWidth: '0', minHeight: '34px', boxSizing: 'border-box', padding: '6px 9px', margin: '0', border: '1px solid var(--line-strong)', borderRadius: '4px', background: 'var(--surface)', color: 'var(--ink)', font: '400 13px/1.5 var(--sans)', boxShadow: 'none' },
      '.cm-search .cm-button': { minHeight: '34px', padding: '6px 10px', margin: '0', border: '1px solid var(--line-strong)', borderRadius: '4px', background: 'var(--surface)', backgroundImage: 'none', color: 'var(--ink)', font: '500 12px/1.5 var(--sans)', cursor: 'pointer' },
      '.cm-search .cm-button:hover': { borderColor: 'var(--jade)', background: 'var(--jade-wash)' },
      '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '5px', margin: '0', minHeight: '32px', color: 'var(--ink-2)', font: '400 12px/1.5 var(--sans)', cursor: 'pointer' },
      '.cm-search input[type=checkbox]': { width: '15px', height: '15px', margin: '0', accentColor: 'var(--jade)' },
      '.cm-panel.cm-search button[name=close]': { top: '10px', right: '8px', width: '32px', minHeight: '34px', padding: '0', border: '1px solid var(--line)', borderRadius: '4px', color: 'var(--ink-2)', font: '400 20px/1 var(--sans)', cursor: 'pointer' },
      '.cm-search :is(input, button):focus-visible': { outline: '2px solid var(--jade)', outlineOffset: '2px' }
    })
  ]
}
