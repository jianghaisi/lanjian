import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { assistantSearchLimit, assistantTextMatches, nextAssistantMatch } from '../services/assistant-text-search'

type TextGroup = { text: string; nodes: Array<{ node: Text; offset: number }> }
type Match = { range: Range; body: HTMLElement; block: number; start: number; end: number }
const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,pre,td,th,blockquote,div'

/** Inline emphasis may split text nodes; paragraphs and line breaks separate matches. */
function textGroups(body: HTMLElement): TextGroup[] {
  const groups: TextGroup[] = [], walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let owner: Element | null = null, group: TextGroup | undefined, node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === 'BR') { owner = null; group = undefined }
      continue
    }
    const block = node.parentElement?.closest(blockSelector) ?? body
    if (!group || block !== owner) { owner = block; group = { text: '', nodes: [] }; groups.push(group) }
    group.nodes.push({ node: node as Text, offset: group.text.length }); group.text += node.textContent ?? ''
  }
  return groups
}

/** DOM ranges never modify source Markdown, author selection, copy or quote text. */
export function useAssistantReading(root: Ref<HTMLElement | undefined>, enabled: Readonly<Ref<boolean>>, scope: 'conversation' | 'history' = 'conversation') {
  const query = ref(''), matches = ref(0), active = ref(-1), limited = ref(false), searching = ref(false), headings = ref<Array<{ label: string; element: HTMLElement }>>([])
  let ranges: Match[] = [], indexedQuery = '', timer: ReturnType<typeof setTimeout> | undefined, observer: MutationObserver | undefined
  const highlightKey = scope === 'history' ? 'assistant-history-find' : 'assistant-find', activeKey = highlightKey + '-active'
  const bodySelector = scope === 'history' ? '.assistant-history-goal > p,.assistant-history-response,.field-candidate-comparison pre' : '.assistant-message-body'
  const registry = () => (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  function clearHighlights() { registry()?.delete(highlightKey); registry()?.delete(activeKey) }
  function paint() {
    const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!enabled.value || !Highlight) { clearHighlights(); return }
    registry()?.set(highlightKey, new Highlight(...ranges.map(match => match.range)))
    registry()?.set(activeKey, new Highlight(...(ranges[active.value] ? [ranges[active.value]!.range] : [])))
  }
  function rebuild() {
    clearTimeout(timer); timer = undefined
    const previous = indexedQuery === query.value ? ranges[active.value] : undefined
    const replies = [...(root.value?.querySelectorAll<HTMLElement>(scope === 'history' ? '.assistant-history-response' : '.assistant-chat-message.assistant .assistant-message-body') ?? [])]
    headings.value = replies.flatMap((body, index) => [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].map(element => ({ label: scope === 'history' ? element.textContent || '' : `回复 ${index + 1} · ${element.textContent}`, element })))
    ranges = []; limited.value = false; indexedQuery = query.value
    if (enabled.value && query.value) scan: for (const body of root.value?.querySelectorAll<HTMLElement>(bodySelector) ?? []) {
      const groups = textGroups(body)
      for (let block = 0; block < groups.length; block++) {
        const group = groups[block]!
        for (const match of assistantTextMatches(group.text, query.value, assistantSearchLimit + 1 - ranges.length)) {
          if (ranges.length === assistantSearchLimit) { limited.value = true; break scan }
          const start = group.nodes.find(item => item.offset + item.node.length > match.start), end = group.nodes.find(item => item.offset + item.node.length >= match.end)
          if (!start || !end) continue
          const range = document.createRange()
          range.setStart(start.node, match.start - start.offset); range.setEnd(end.node, match.end - end.offset)
          ranges.push({ ...match, range, body, block })
        }
      }
    }
    matches.value = ranges.length; searching.value = false
    active.value = previous ? ranges.findIndex(match => match.body === previous.body && match.block === previous.block && match.start === previous.start && match.end === previous.end) : -1
    paint()
  }
  function schedule() { if (!timer) timer = setTimeout(rebuild, 100) }
  function scrollToRect(rect: DOMRect, owner: Element) {
    const scroll = root.value?.closest<HTMLElement>(scope === 'history' ? '[data-testid="assistant-history-preview"]' : '[data-testid="copilot-chat-view-scroll"]')
    if (!scroll) return
    const header = scope === 'history' ? scroll.querySelector('.assistant-history-detail-header') : owner.closest('.assistant-chat-message')?.querySelector(':scope > .assistant-message-reading-header')
    const inset = (header?.getBoundingClientRect().height || 0) + 12
    scroll.scrollTo({ top: scroll.scrollTop + rect.top - scroll.getBoundingClientRect().top - inset, behavior: 'instant' })
  }
  function jumpHeading(index: number) {
    const element = headings.value[index]?.element
    if (element && root.value?.contains(element)) scrollToRect(element.getBoundingClientRect(), element)
  }
  function jump(direction: number) {
    // Enter immediately after typing must use the new query, not the debounce's old ranges.
    if (timer || indexedQuery !== query.value) rebuild()
    active.value = nextAssistantMatch(active.value, ranges.length, direction); paint()
    const match = ranges[active.value]
    if (match) scrollToRect(match.range.getBoundingClientRect(), match.body)
  }
  watch(query, () => { searching.value = enabled.value && Boolean(query.value); ranges = []; matches.value = 0; active.value = -1; limited.value = false; clearHighlights(); clearTimeout(timer); timer = undefined; schedule() }, { flush: 'sync' })
  watch(root, value => {
    observer?.disconnect(); ranges = []; active.value = -1; clearHighlights()
    if (value) { observer = new MutationObserver(schedule); observer.observe(value, { childList: true, subtree: true, characterData: true }) }
    rebuild()
  }, { flush: 'post', immediate: true })
  watch(enabled, rebuild, { flush: 'sync' })
  onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(timer); clearHighlights() })
  return { query, matches, active, limited, searching, headings, jump, jumpHeading }
}
