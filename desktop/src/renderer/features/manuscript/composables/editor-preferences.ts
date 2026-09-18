import { computed, reactive, toRefs } from 'vue'

export type EditorFontFamily = 'serif' | 'song' | 'kai' | 'sans'
export type EditorGuideStyle = 'off' | 'solid' | 'dashed'

export type EditorPreferences = {
  fontScale: number
  leading: number
  fontFamily: EditorFontFamily
  pageWidth: number
  guideStyle: EditorGuideStyle
}

type LegacyEditorPreferences = Partial<EditorPreferences> & { guideLines?: boolean }

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export const defaultEditorPreferences: Readonly<EditorPreferences> = Object.freeze({
  fontScale: 1,
  leading: 1.8,
  fontFamily: 'serif',
  pageWidth: 760,
  guideStyle: 'solid'
})

const keys = {
  fontScale: 'lanjian-editor-font-scale',
  leading: 'lanjian-editor-leading',
  fontFamily: 'lanjian-editor-font-family',
  pageWidth: 'lanjian-editor-page-width',
  guideStyle: 'lanjian-editor-guide-style',
  legacyGuideLines: 'lanjian-editor-guide-lines'
} as const

const fontFamilyValues = new Set<EditorFontFamily>(['serif', 'song', 'kai', 'sans'])
const guideStyleValues = new Set<EditorGuideStyle>(['off', 'solid', 'dashed'])

export const editorFontFamilyCss: Record<EditorFontFamily, string> = {
  serif: 'var(--serif)',
  song: '"SimSun", "Songti SC", serif',
  kai: '"KaiTi", "Kaiti SC", var(--kai)',
  sans: '"Microsoft YaHei", "PingFang SC", sans-serif'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function normalizeEditorPreferences(value: LegacyEditorPreferences = {}): EditorPreferences {
  const fontFamily = fontFamilyValues.has(value.fontFamily as EditorFontFamily)
    ? value.fontFamily as EditorFontFamily
    : defaultEditorPreferences.fontFamily
  return {
    fontScale: clampNumber(value.fontScale, defaultEditorPreferences.fontScale, 0.85, 1.25),
    leading: clampNumber(value.leading, defaultEditorPreferences.leading, 1.6, 2.5),
    fontFamily,
    pageWidth: clampNumber(value.pageWidth, defaultEditorPreferences.pageWidth, 620, 980),
    guideStyle: guideStyleValues.has(value.guideStyle as EditorGuideStyle)
      ? value.guideStyle as EditorGuideStyle
      : typeof value.guideLines === 'boolean'
        ? value.guideLines ? 'solid' : 'off'
        : defaultEditorPreferences.guideStyle
  }
}

export function readEditorPreferences(storage?: PreferenceStorage): EditorPreferences {
  if (!storage) return { ...defaultEditorPreferences }
  return normalizeEditorPreferences({
    fontScale: storage.getItem(keys.fontScale) as unknown as number,
    leading: storage.getItem(keys.leading) as unknown as number,
    fontFamily: storage.getItem(keys.fontFamily) as EditorFontFamily,
    pageWidth: storage.getItem(keys.pageWidth) as unknown as number,
    guideStyle: storage.getItem(keys.guideStyle) as EditorGuideStyle,
    guideLines: storage.getItem(keys.legacyGuideLines) === null ? undefined : storage.getItem(keys.legacyGuideLines) !== 'false'
  })
}

export function writeEditorPreferences(value: LegacyEditorPreferences, storage?: PreferenceStorage) {
  const normalized = normalizeEditorPreferences(value)
  if (storage) {
    storage.setItem(keys.fontScale, String(normalized.fontScale))
    storage.setItem(keys.leading, String(normalized.leading))
    storage.setItem(keys.fontFamily, normalized.fontFamily)
    storage.setItem(keys.pageWidth, String(normalized.pageWidth))
    storage.setItem(keys.guideStyle, normalized.guideStyle)
    storage.setItem(keys.legacyGuideLines, String(normalized.guideStyle !== 'off'))
  }
  return normalized
}

const browserStorage = typeof window === 'undefined' ? undefined : window.localStorage
const editorPreferences = reactive<EditorPreferences>(readEditorPreferences(browserStorage))

export function useEditorPreferences() {
  function save() {
    Object.assign(editorPreferences, writeEditorPreferences(editorPreferences, browserStorage))
  }

  function reset() {
    Object.assign(editorPreferences, defaultEditorPreferences)
    save()
  }

  return {
    ...toRefs(editorPreferences),
    fontFamilyCss: computed(() => editorFontFamilyCss[editorPreferences.fontFamily]),
    save,
    reset
  }
}
