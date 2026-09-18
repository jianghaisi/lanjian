# V3 offline companion inference probe

Historical experiment record. The later author-approved selected V2 runtime and residency rules are normative in `v3-companion-speech-runtime.md`; older current-engine, idle120s and close-unload statements below describe earlier probes only.

Status: task-scoped experimental adapter, NOT an accepted product voice service. Primary Qwen TTS failed latency/compatibility probes; no renderer/preload/microphone wiring is released by this document.

2026-09-12 clarification: the Kokoro library prototype's path-ID/session-ID mismatch is fixed; isolated real Electron proactive speech and Qwen chat + Kokoro playback now pass. This is functional playback evidence, not final voice-quality/performance acceptance (chat first audio still about 17 seconds). GPT-SoVITS remains a standalone audition, not the product engine. Earlier Qwen voice constraints remain profile-specific, not an invented restriction on the public-reference audition.

## 1. Scope / trigger

Applies to `desktop/src/main/modules/companion/adapters/companion-voice/` and explicit developer setup/benchmarks in `desktop/scripts/companion-voice/`. Narrow runtime exception is author-approved in `v3-runtime-boundaries.md`; it is not permission for a Python product backend or HTTP service.

## 2. Signatures

- `LocalVoiceRuntime(root, fixedWorkerScript)`; `available()`, `run(LocalInferenceRequest, signal?, delta?)`, `stop()`.
- Fixed worker actions `chat | tts | asr`; no tools, book storage, URL, shell or arbitrary output-path action.
- `encodeFrame(header, pcm?)`; `VoiceFrameReader.push(Buffer): VoiceFrame[]`.
- Explicit setup: `node scripts/companion-voice/download-models.mjs`; probe: `npx tsx scripts/companion-voice/benchmark.ts --text-only`; separate `probe-tts.py [--fp32]`.

## 3. Contracts

Pipe frame: 4-byte LE JSON-header byte length, UTF-8 JSON, exactly `pcmBytes` bytes PCM16. Header <=32768 bytes, output PCM <=1440000 bytes; ASR input <=960000 bytes at 16000Hz mono. Version 1 and bounded request ID required. Incremental chat frames carry `kind:delta,text`; terminal frames carry `ok` plus bounded inference data. No full recording copies on every text frame.

Worker owns only local inference. Inputs: chat text <=2000 chars, context <=4000, at most six short history messages; TTS <=180 chars and Vivian/Serena allowlist. No conversation or recording persistence. Explicit probes write only synthetic artifacts, not author data.

Root `E:/项目/novel-project/.local/companion-voice` is outside the app repository. Pinned `models.mjs` records revisions, sizes, LFS SHA-256 and Git-blob hashes. Unexpected existing finals are preserved, not overwritten. All runtime dependencies are isolated Python 3.12; observed package versions recorded in `requirements.lock`. Redistribution/license review is separate, especially upstream SenseVoice model terms.

Inference env uses an allowlist: Windows runtime dirs, local TEMP/TMP/PATH/cache, offline Hugging Face switches and two-thread math settings; never inherit writer credentials/proxies. Directly launch the contained base interpreter identified by validated `pyvenv.cfg`; Windows venv redirectors create an extra process and must not become the cancellation target. Worker imports only its fixed local venv site-packages.

## 4. Validation and errors

- Bad length/version/ID/odd PCM/invalid UTF-8/JSON → protocol error, terminate owned worker.
- Unexpected or stale frame → terminate, never dispatch to another operation.
- Busy → reject; bounded single pending job, no unbounded queue.
- Abort/180s timeout → reject and terminate only owned child; idle120s unload.
- Python numeric/synthesis error → fixed `INFERENCE_FAILED`, no traceback/prompt in renderer.
- `available()` checks files only; it MUST NOT be presented as product voice readiness. Hash manifest and actual load/performance checks remain required before integration.

## 5. Good / base / bad

Good: fixed synthetic title supplied to Qwen on CPU; streamed text and public ASR fixture decoded locally.
Base: FP32 Qwen TTS produced finite waves but took 27.65/29.27 seconds for 3.6/2.72 seconds audio. This fails the real-time gate.
Bad: call the primary voice ready because files exist, a WAV is finite or its weights fit GPU memory; silently install another voice model; start an HTTP daemon.

## 6. Required tests

`companion-voice-runtime.test.ts`: fragmented binary/UTF-8, ordered frames, length/version/ID rejection. Product integration still requires validated IPC input/result/event DTOs, owner/frame/epoch isolation, cancellation/exit tests, permission intent, zero novel writes, playback and actual ten-round warm benchmark. These are NOT fulfilled by the current probe.

## 7. Wrong vs correct

Wrong: launch generic system Python and inherit all environment variables; kill only a Windows venv launcher; infer audible correctness from finite PCM.

Correct: use isolated, validated runtime paths and a fixed action protocol; terminate the actual worker; measure latency, listen to samples and obtain explicit author choice before changing the voice profile.

## GPT-SoVITS public-reference audition contract (2026-09-11)

The library semantic-notice bridge contract is appended after the experiment contract; neither expands the fixed worker protocol into tool or data access.

### 1. Scope / trigger

Author “可以，开始” and “先用项目公开示例验证” authorize this task's developer-only v2ProPlus reference-voice experiment. This is not authorization for training, a cloud endpoint, a WebUI/HTTP listener, microphone collection, manuscript processing or changing the product voice. Preserve the existing application venv and user processes.

### 2. Signatures

`download-models.mjs --gpt-sovits` explicitly selects `gpt-sovits-model.mjs`. `probe-gpt-sovits.py [--precision fp16|fp32] [--check-imports]` has three fixed Chinese texts and a pinned public reference, no arbitrary input/output URL/path interface. Internal worker flag is for the developer supervisor only.

### 3. Contracts

Pin source revision, model/reference size and hash; verify the reviewed G2PW literal-only/no-pickle source patch before startup. All 17 assets are verified before actual inference. GPT setup requests exact bounded 16 MiB ranges and checks Content-Range plus final whole-file hashes. Unexpected final files are preserved. Upstream config execution is restricted to reviewed pinned constant-only G2PW config; tensor loads force `weights_only` through the environment.

Use a separate Python 3.12 experiment environment with the observed dependency lock. Child environment excludes credentials/proxies and enables offline library modes; a Python audit hook rejects socket connect/bind/address resolution. Do not call the upstream language detector for the fixed all-Chinese fixtures: it may try to download fastText even in `all_zh`. The narrow segmenter rejects English, Japanese and unspecified language instead of claiming general multilingual support. No trained artifact or reference recording is created from author data.

### 4. Validation / errors

Launch the contained base interpreter with `-I`, explicit stdout/stderr pipes and a hidden window. Print diagnostic stages in the developer console, not a renderer. Missing patch/hash/CUDA or unsupported text fails closed. Bound the child to 240 seconds; terminate the owned process on parent exit. Each generated sample must be mono 32 kHz PCM16, finite, non-silent, 0.5–20 seconds; artifacts use a unique directory. Numeric health is not pronunciation or voice-quality acceptance. ONNX CPU phonemizer warnings do not imply Torch CUDA is unavailable.

### 5. Good / base / bad

Good: three synthetic texts, pinned CosyVoice example, offline process, author audition. Base: RTX 2060 FP16 loaded in 5.86 seconds; first synthesis 16.94 seconds, subsequent 5.32/6.40 seconds for 6.1/7.5 seconds audio. These two warm cases are not a ten-round or combined editing/Live2D benchmark. Bad: advertise instant speech because warm RTF is below 1, or infer an emotion control from an optimistic test filename.

### 6. Required tests

`test-gpt-sovits-probe.py`: environment privacy/offline, containment, bounded fixtures and Chinese-only routing. Validate 17 file hashes, import/weight load, WAV format/health, transcript spot checks, process exit and actual resource peaks. Human listening and app playback remain required before product adoption. See the task research record for exact artifacts and observed transcription differences.

### 7. Wrong vs correct

Wrong: assume `HF_HUB_OFFLINE=1` stops every third-party downloader, hide stderr with `CREATE_NO_WINDOW`, rebuild Torch despite an existing verified cache, or silently reuse an unpatched upstream pickle loader. Correct: no-socket boundary plus explicit Chinese routing, visible bounded diagnostics, the known local cache, source-patch integrity check and separate quality/latency acceptance.

## Library presence bridge (2026-09-12)

### 1. Scope / trigger

Author explicitly approves proactive writer companionship using actual UI events/time, speech plus short captions, and manual chat only on 3s hold. Only library continue-hover and late-night are currently integrated. No writing/assistant/save event claims, no book scan, microphone, cloud or model replacement.

### 2. Signatures

- `CompanionVoiceOpen = {continueWorkId:'library-current'|null}` via existing `companion-voice:open`.
- Existing `CompanionVoiceRequest.action` adds `notice`; `notice?:'continue-hover'|'late-night'`.
- `CompanionVoiceService.updateLibrary(CompanionLibraryProjection[])`, `open(owner,selector)`, `request(owner,input,emit)`.
- `CompanionNoticePolicy.claim(reason,now:Date,workId:string|null):boolean` shared pure policy; main and renderer have separate policy instances.

### 3. Contracts

Renderer sends only the literal current-work selector, not project path or arbitrary title/time. Main resolves it against the already-confirmed library projection's first work. Real project IDs are currently directory paths; keep them internal. Session/request IDs retain the bounded opaque-token decoder. A selected work changing/disappearing invalidates the session; null permits no-work conversation/night reminder.

Notice requests require empty `text` and exactly one allowlisted reason; other actions reject `notice`. Main computes local clock and title/chapter from its projection, creates a bounded truthful reminder, skips `inference.chat`, and uses the existing `inference.speak`/PCM path unless muted. Main enforces 90s global, 10min per work, 23–05/once-per-night independently across session reopenings. No notice queue, persistent history, DB access or novel mutation. Existing owner/session/sequence/cancel/bounded-audio checks apply unchanged. Voice engine remains Kokoro FP32 CPU.

### 4. Validation & error matrix

- Path/unknown selector, extra DTO field, missing/unknown notice, arbitrary notice text → input decoder rejection.
- Current-work selector without confirmed work; stale/wrong-owner/replayed request → recoverable `CONFLICT`.
- Notice outside time/cooldown/required-work limits → recoverable `CONFLICT`, no inference.
- Window/scope close → abort current owned request and suppress late text/audio.
- No local files/runtime or synthesis failure → honest error, never system/cloud speech fallback.

### 5. Good / base / bad

Good: `open({continueWorkId:'library-current'})` resolves internal `E:\\books\\novel` to title only; hover reminder contains that title and no path. Base: `null` + late-night uses main clock without a book. Bad: treat a filesystem project ID as session-token syntax, or loosen every ID decoder to accept paths.

### 6. Tests required

`companion-voice-contracts.test.ts`: selector/reason allowlist and text rejection. `companion-voice-service.test.ts`: path-valued cached ID without leakage, work invalidation, owner/stale cancellation, notice bypasses LLM, main clock/day rejection/cooldown across sessions. `companion-presence.test.ts`: temporal boundaries. Real isolated Electron smoke: native hover plus audible PCM and no composer, long-hold chat, real Qwen text, audible Kokoro output, prompt stop and unchanged synthetic book hash. File availability/unit mocks alone are not audio evidence.

### 7. Wrong vs correct

Wrong: `decodeId(projectDirectory)` or renderer submits `text:'保存成功'` as a proactive claim. Correct: main-resolved `'library-current'`, semantic event allowlist and main-derived sentence. Keep path identities internal and opaque voice session tokens validated independently.
