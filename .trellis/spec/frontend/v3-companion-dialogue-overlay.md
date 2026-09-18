# V3 companion dialogue overlay

Status: active author-approved interaction contract; visual acceptance remains task-specific.
Source task: `09-11-v3-companion-local-voice-and-safe-dialogue`. Later author instructions supersede its original reserved-layout proposal.

## 1. Scope / trigger

Any library mascot dialogue, including partial/streaming text, separated input, sound/appearance preferences and responsive placement. This contract does not certify intelligent conversation or microphone/audio integration.

## 2. Signatures

- `placeCompanionDialogue({safe,stage,character,protectedUi?,desired,preference?}): DialoguePlacement`
- `Live2DCompanion.getProtectionRects(clip?): DialogueRect[]`
- `normalizeDialogueAppearance(unknown): CompanionDialogueAppearance`
- `useCompanionDialogueAppearance(): {preferences,error,update,reset}`
- `placeCompanionComposer(safe: DialogueRect, stage: DialogueRect, desiredHeight?: number): DialogueRect & {width:number;height:number}`
- `normalizeCompanionVoicePreferences(unknown): {voice: CompanionVoiceId;volume:number;mute:boolean;proactive:boolean;subtitles:boolean;textModel:boolean;preload:boolean}`
- `useCompanionVoicePreferences(): {preferences,error,update}` (one shared app-local value)
- `useCompanionVoice(continueWorkId, {autoOpen?:boolean,input?:Ref<string>}): {open,close,run,stop,...}`
- `createCompanionHold(open, changed, tap, schedule?, clear?, now?): {start,release,cancel}`; hint at 1000 ms, chat at total 3000 ms. `now` is monotonic (`performance.now`), injectable for tests.
- `useCompanionPresence(scope, hover, manual): {visible,caption,status,playing,cancel,tap}`; lazy voice session.
- `useCompanionRuntime()` is owned by `ProjectLibrary`, synchronizes model options, starts optional warmup during boot and suspends on unmount. `companionPreparationPhase: Ref<'idle'|'loading'|'ready'|'failed'>` exposes the existing preparation result; `retryCompanionPreparation(): Promise<void>` delegates to that live owner, never a second worker.
- `useCompanionBoot(corePhase, coreError, preview)` derives readiness from saved enabled-model/preload choices; `useBootCompletion(ready, complete)` owns the cancellable visible 3000ms completion, not core loading or a new inference job.

## 3. Contracts

Geometry is in CSS viewport pixels. `DialogueRect` has `left/top/right/bottom`; placement has `kind: above | right | unavailable`, `left/top/width/height`. Read actual visible Live2D drawable vertices transformed through model layout and rendered canvas bounds. Preserve separate drawable rectangles; a whole-canvas union includes transparent space.

`CompanionDialoguePanel.vue` is teleported to `body`, `position:fixed`, above normal modules. It never participates in page layout: no spacer, reserved row, padding/margin change, clipping or rescaling of the character. It may extend beyond the left column and cover modules; character geometry stays protected. Prefer above, then right; keep a 12 CSS-pixel gap and the entire panel inside the safe viewport. At impossible all-viewport art composition return `unavailable`, never a fake safe position.

Natural content height is observed with `ResizeObserver`; only the floating panel position changes when text wraps. No initial 360px empty box. Long content scrolls under the bounded header. Recompute for window/zoom, model readiness, appearance and completed character transform changes. Opening a native settings dialog dismisses the popup without stealing settings focus.

Per the author's 2026-09-12 clarification, input is a second fixed, transparent dock at the left character column's bottom, not part of the reply panel. Use 12px bottom/side insets, a maximum 400px width and background-only 48% opacity; clamp to the safe viewport. It may overlay lower clothing when art fills the column, but must not manufacture space by moving/cropping art or modules. Reply placement includes its measured rectangle in `protectedUi`; growing reply text must not move the dock. Both portals close together. Keep plain Enter for newlines, Ctrl+Enter for sending, and Escape for closing; never consume composition/229 confirmation keys. The parent retains an unsent draft across settings visits and clears it on work scope changes; no draft/history goes into preferences.

Sound controls exist only within the existing top-right native settings dialog. Reuse `lanjian-companion-voice-v1`, with `voice` limited to `ningguang/ganyu/keqing` (old Kokoro/unknown IDs migrate to Ningguang), `volume` finite/clamped to 0–1 (default .65), and strict boolean `mute` (default false). Preserve proactive/subtitle flags. Settings and active playback observe one shared store; persist successfully before publishing a change. Rendering settings must not start a model session. Explicit preview may open one; dialog close, stop or unmount invalidate pending work and close any late session instead of playing it. GPT-SoVITS is now the selected runtime with no Kokoro fallback; file installation is not readiness. Closing chat retains idle models, not private conversation history. Entering a work, 10-minute idle or writer resource handoff unloads them; active cancellation remains immediate. Backend executable contract: `../backend/v3-companion-speech-runtime.md`.

Local presentation key `lanjian-companion-dialogue-v1` contains only:

| Field | Default | Bounds |
| --- | --- | --- |
| opacity | .78 | .35–1; background only, not text |
| fontSize | 16 | 12–24 CSS px |
| width | 340 | 220–560 CSS px, further limited to 38% of viewport |
| maxHeight | 260 | 140–420 CSS px, also limited by viewport |
| placement | auto | auto / above / right; preference never disables avoidance |

Latest author correction: full reply/input portals are absent until holding the character for a total of 3 seconds. A release before 1000ms invokes the existing safe action/Nod once plus a preset short response, optionally synthesized by GPT according to the speech-model switch; never opens full chat or invokes Qwen. Tap is independent of the proactive switch and displays a short caption even with reminders off. Ignore repeat taps while busy/playing and within 3 seconds, never queue them. No hint is visible before 1000ms; then show the remaining 2000ms progress from one-third to full. Release at 1000–2999ms cancels without tapping. Completed hold opens chat only; its subsequent release/browser click must not trigger an action. Pointer cancel/leave, movement beyond 8px, focus loss, settings, work scope change or unmount cancels both timers with no action. Keyboard Space/Enter supports the same gesture; only the matching keyup releases it. Ignore repeat/composition and competing input sources. Use elapsed monotonic time on release as well as timers; delayed renderer timers must not turn a long press into a tap. Guard queued callbacks by gesture identity.

Proactive speech uses a separate compact `CompanionNotice`, fixed/teleported above modules, 76% background opacity and no input. Reuse drawable avoidance; no available slot means suppress the notice, not overlap the face. Continue Writing pointer/focus dwell is 1200ms; local late-night period is 23:00–05:00. Reminders are globally at least 90s apart, same work at least 10 minutes apart, and once per calendar night (midnight does not reset it). No backlog. Block during manual chat, native dialog, background/unfocused window, or for 6s after typing; scope changes cancel pending work/audio. Hard lifetime 22s, dismiss after audio ends plus 4.5s. These two events use main-grounded rules, not an always-running LLM or invented save/task outcomes.

Sound preferences add `proactive` and `subtitles`, both default true, with explicit false honored for old-record migration. Controls stay in top-right settings. Proactive voice and caption share one ephemeral session, independent of the manual composer. Main validates the semantic reason; it does not trust renderer-provided reminder sentences.

Model choices are independent: `textModel` toggles Qwen vs honest preset responses; `mute` now disables/releases the speech model, unlike volume zero. New settings default to presets, while known saved voice records without `textModel` preserve prior intelligent-chat behavior. `preload` defaults true and only warms enabled profiles. Both off still permit the manual preset panel with no model installation requirement. Controls and a truthful mode/preparation label stay in the top-right settings. Configuration is synced before session opening; stale configure/open outcomes are ignored and late sessions closed. Toggling modes stops current output but preserves unsent input.

The library host mounts underneath the opening overlay and optionally prepares enabled text/speech profiles. Latest author override: initial boot waits for this actual success, presents “已就绪，可以进入”, then completes over 3000ms. No-models/preload-off bypass model waiting; preview never initiates a preparation job. Failed warmup exposes retry/explicit skip-wait. Skipping does not persist a changed mode or mark models ready; pending work may continue, but failed work is reported as not ready. Core errors cannot be skipped. A separate host watcher applies saved model/voice/preload changes; merely rendering settings does not start a session. Host unmount invalidates pending configuration before suspend. No repeating idle preloader. Proactive reminders/taps are blocked behind the boot overlay, and reminders skip initial preparation and obsolete hovers. Deliberate tap emits its preset text before waiting for speech. UI close and completed playback cancel retain idle models. Backend limits are specified in `v3-companion-speech-runtime.md`.

For both tap/proactive captions, start the 4500ms dismissal only after the current `voice.run()` has settled, `busy === false` AND `playing === false`. Empty queue between GPT sentence fragments may last longer than 4500ms; it must not close the session or cancel synthesis. Renewed playback cancels the dismissal timer. New response/cancel/unmount clears the completed flag and timer; explicit cancel and original hard lifetimes still apply. Failed replies use the bounded 6000ms error caption. Do not arm a timer during asynchronous session opening.

## 4. Validation and error matrix

- Missing/malformed/non-finite preference → bounded defaults.
- Storage failure → explicit unsaved error; do not claim preference was stored.
- Unknown geometry → conservative right candidate; recompute on `data-ready`.
- No valid floating slot → unavailable notice; never resize the art or shift modules.
- Long/large-font text → scroll body; header close remains visible.
- Settings preference write failure → preserve the last saved shared value and show an unsaved error.
- Close during pending preview status/open → no late preview; close any session received after invalidation.
- Session unavailable → visible failure with disabled send/replay; preserve editable unsent text, never fake a successful model reply.
- Boot model loading/failed → waiting/retry/explicit model skip; core error → retry only. Preview or native window not shown → no automatic completion timer. Late/stale preparation → ignored, never a ready claim.
- Proactive runtime unavailable → brief truthful unavailable caption, no pretend spoken output; dismissal stops audio and pending inference.
- 999ms release → one action; 1000ms release → cancel, no action/chat; 2999ms release → cancel; 3000ms completion → one chat, no action. Cancel always produces neither, even if timers are delayed.

## 5. Good / base / bad

Good: 105px short bubble grows to 132px and eventually caps at 260px while all module rectangles remain identical.
Base: above/right preference changes the candidate order, not character scale or book data.
Bad: make the left art container `overflow:hidden`, reduce its height, or insert a blank row above the heading.

Gesture: good = `pointerup → release()`, `pointerleave/blur → cancel()`; bad = every `pointerup → cancel()` plus an empty click handler, which erases taps. Opening chat must not call the tap acknowledgment function.

## 6. Required tests

- `companion-dialogue-placement.test.ts`: viewport/zoom, gaps, right fallback, streaming heights, no input geometry mutation, impossible composition.
- `companion-dialogue-appearance.test.ts`: bounds, invalid values and independent preference fields.
- Real Electron `companion-dialogue-overlay-smoke.ts`: short/growing/long text, larger character, fixed overlay, exact unchanged heading/hero/toolbar/art-viewport rectangles, overflow and screenshots. Fixture text is layout evidence, not a model-response claim.
- Built settings: persist all four numeric sliders and reset; test sticky header navigation. Inspect screenshots; do not use production Vue private instance hooks as a test API.
- `companion-composer.test.ts`: bottom docking across viewport/zoom/heights, no geometry mutation, migration/clamping, shared voice store and failed-save behavior.
- `companion-voice-lifecycle.test.ts`: settings mount does not open a session; close during pending status/open suppresses stale errors and closes late sessions; retry/unmount cleanup.
- `companion-boot-completion.test.ts`: single warmup owner, fail/retry, mode-off/preview/skip/core-error gates, 2999/3000ms boundaries, invalidation/unmount; actual composables and audio player must survive an 8000ms sentence gap, then wait for every scheduled source before dismissal.
- `companion-boot-smoke.mjs`: actual Vue component/runtime lifecycle, visible native gate, 3-second timing, enter-now, failure/retry/skip, no-models/on-demand/preview/core failures. Uses deterministic deferred IPC fixtures, not real model-speed evidence. `companion-native-boot-smoke.mjs` separately tests a real installed speech-only startup and full tap playback in an empty isolated app profile.
- Built Electron overlay smoke: separate portals, no sound/input controls inside reply, fixed dock during reply growth, IME/Enter/Ctrl+Enter/Escape handling, unsent draft preserved across settings, saved sound values and three theme screenshots. Synthetic UI fixtures do not certify model audio playback.
- `companion-presence.test.ts`: 999/1000/2999/3000ms boundaries, repeat/release/cancel, delayed and stale callbacks, 90s/10min cooldowns, invalid time and overnight date boundary. Actual `companion-presence-smoke.ts`: native tap produces action/animation without chat, hint absent at 700ms and present at 1200ms, pending release/movement cancels, Space tap and Return hold/matching release work; total 3s opens once with no duplicate tap. The separate voice smoke verifies hover causes audible local TTS + caption without composer or moved module rectangles, dismiss stops audio, repeat hover stays quiet.

## 7. Wrong vs correct

Wrong: `art.style.insetBlockStart = bubbleHeight; art.style.overflow = 'hidden'`.

Correct: keep art and modules untouched; update only the teleported bubble's logical inset/size using measured geometry. Apply `color-mix` to its background instead of whole-panel `opacity`.

Correct separated ownership: `useCompanionVoice(scope, {input: draft})` owns conversation events; the teleported composer emits user intent to that owner. A settings-only `useCompanionVoice(ref(null), {autoOpen:false})` opens on explicit preview and closes with the native dialog. Do not open a second conversation session merely to render its input field.

Wrong: `watch(playing, false => setTimeout(cancel, 4500))`. Correct: wait for the current response to finish AND all audio to drain before scheduling caption dismissal; a short sentence can finish playing while later sentences are still synthesizing.
