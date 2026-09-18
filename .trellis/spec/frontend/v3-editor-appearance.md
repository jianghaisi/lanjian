# V3 editor appearance and guide lines

> Status: `verified-current`. Applies to manuscript and outline writing surfaces.

## 1. Scope / Trigger

Apply whenever an editor changes typography preferences, writing-toolbar layout, guide-line rendering or compatibility storage for those preferences.

## 2. Contracts

- Font family, font scale and leading are local display preferences. Changing them must immediately alter the computed style of the active editable surface without changing manuscript text, outline text, revision history or canonical data.
- Manuscript CodeMirror layers explicitly inherit the chosen family, size and line height. The projected pixel size is `16 * fontScale`; the projected line-height is that size multiplied by `leading`.
- `guideStyle` has exactly three values: `off`, `solid` and `dashed`. Manuscript and outline paper share the preference.
- The visible guide period equals the actual computed line height. Guides render on one content layer only so two backgrounds cannot drift into doubled lines.
- Legacy `guideLines=false` migrates to `off`; legacy `true` or an absent style migrates to `solid`. During the compatibility window, saving the new style also updates the legacy boolean.
- Invalid or out-of-range stored values normalize to safe defaults and never block editing.
- Writing toolbar controls are grouped from the left. Narrow editor containers may wrap compactly, but save, history, layout and focus controls remain readable, reachable and non-overlapping.
- The layout panel opens directly below and horizontally overlaps its layout trigger. When the editor narrows, clamp the panel within the editor header instead of detaching it from the trigger or covering the toolbar above it.
- Editor typography and guide controls live in the writing toolbar's layout panel. Do not repeat a “阅读与编辑” control group in the opened project's Settings page.
- Dark selected actions and swatches must set an explicit readable foreground; visible action text is checked, not only the parent background.

## 3. Validation

- Pure tests cover migration, normalization and round-trip persistence.
- Typecheck and desktop build must pass.
- Electron geometry asserts the computed manuscript font size and line height after interaction, all three guide states, a guide period equal to line height, left-aligned toolbar controls, a layout panel anchored below its trigger, and usable controls at the supported compact viewport/zoom.
- Visual review includes the writing surface, dark selected actions and focus mode. Any editor-parity smoke blocked before the editor by fixture bootstrapping is reported separately rather than treated as proof of editor failure.

## 4. Failure behavior

- A bad preference falls back locally; it never writes an empty chapter or replaces the saved manuscript.
- A save or navigation failure preserves the current editable draft under the existing manuscript guard.
