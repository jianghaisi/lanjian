# V3 本地模型商店

> Engineering contract for `09-12-v3-local-writing-models`; visual author acceptance is still recorded in the task.

## 1. Scope / Trigger

Applies to 设置 → AI 与模型 → 本地模型商店, task model routing and one-off assistant selections. The current store reuses the existing Qwen; future catalog/download expansion is not represented as installed functionality.

## 2. Signatures

`LocalModelStore.vue` receives `LocalModelsApi`, `AiSettings`, `busy`; emits `use(model, shared | AiTask)` and `changed`. `use-local-models` owns detection state/polling/cancellation. `localModelAssignment(settings, model, target)` produces a settings patch.

## 3. Contracts

- One factual Qwen card: identity, size, quantization, license, tested context/output profile, status and supported writing modules. No fabricated model inventory, progress or executable download control.
- The current local model feature is labelled Beta. Existing Qwen validates routing and tool execution; readiness does not promise long prose or production writing quality. Failed generation stays a visible failure without automatic adoption.
- Detection and selection are separate actions. Selection is disabled until ready; explicit selection saves the new assignment. Switching from shared to per-task first preserves the shared profile for all other tasks.
- Model catalog choices remain keyed by `(connectionId, model)`. An online and local model with the same name remain separate choices. Missing local resources remain visible with a reason and cannot become an implicit fallback.
- Local cards/choices say 本机运行 / 无需密钥. Connection credential editors and image-model choices contain remote connections only; manual unknown model IDs remain available for remote providers.
- A one-off local choice shows a numeric output budget (default 2048, 128–4096 tokens) and carries it through field/prose handoff. Changing it invalidates an earlier context preview. Defaults change only through explicit settings save.
- Writing availability uses `modelConfigured`; `apiKeyConfigured` retains its truthful remote-credential meaning. Local readiness must not make research or image credentials appear configured.
- No paths, executable arguments, model URLs or raw IPC are exposed through the store. Unmounting releases polling and stops only the detection started by that view.

## 4. Validation & Error Matrix

| State | UI behavior |
| --- | --- |
| Loading / failed list | Status or retry action |
| Detected | 检测并启用; selection disabled |
| Verifying / checking | Real progress and stop action |
| Ready | Can explicitly assign to all writing or one task |
| Missing / failed / cancelled | Preserve assignment, show reason/retry; no cloud fallback |
| Output outside profile | Main rejects; no silent clipping |

## 5. Good / Base / Bad Cases

- Good: choose Qwen for 正文 and keep the other task choices, then inspect the candidate before applying it.
- Base: a remote-only user can still add and test interfaces and enter unknown provider model IDs.
- Bad: show local text models in the image picker, ask for a fake API key, or display “模型未配置” merely because a working local route has no cloud credential.

## 6. Required Tests

Use real built Electron, an isolated user profile and a synthetic book. Verify detection, shared/per-task save, one-off budget, candidate generation, unadopted body preservation, cold reopen, keyboard use, Chinese text and narrow layouts. Screenshot evidence is in `desktop/artifacts/local-model-store`; automation failures and literary limitations remain in task evidence.

## 7. Wrong vs Correct

- Wrong: enable a model because a catalog row exists.
- Correct: disable selection until the main process reports a completed runtime check.
- Wrong: overwrite all task profiles when assigning a model to only 正文.
- Correct: preserve all other profiles, including when moving from shared routing.

For zoomed Electron checks, capture the main BrowserWindow via `capturePage()`. Playwright page screenshots can clip native zoom output even when DOM bounds fit. Select the index.html window explicitly because an auxiliary pet window may be first in getAllWindows(). Record CSS viewport, native content bounds and zoom together.
