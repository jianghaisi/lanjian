> V3 status: `candidate-for-v3`. This old feature-specific type list is evidence; active boundary rules live in `v3-renderer-boundaries.md`.

# Type safety

- Renderer application code is TypeScript; JavaScript is limited to temporary migration files and must not grow.
- Shared DTOs and event payloads are defined once under `desktop/src/contracts` and validated at runtime at the IPC boundary.
- `window.novelDesktop` exposes the exact `DesktopApi`; no `any`, index signatures or generic channel calls.
- Never assert untrusted IPC/file/AI data with `as`; parse it through schemas.
- Domain identifiers use distinct branded types where mixing paths, project ids, job ids or entity ids would be unsafe.
- Exhaustively handle discriminated unions for job states and app errors.
- 逐章采用的 preview/input/result 与 receipt 必须定义在 `desktop/src/contracts`，main 对未知字段、非法 SHA-256、重复章号和无候选引用执行运行时拒绝；renderer 不得用 `as` 拼装权威正文或采用元数据。
