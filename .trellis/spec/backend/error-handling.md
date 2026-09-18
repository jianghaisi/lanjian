> V3 status: `candidate-for-v3`. Historical feature-specific error detail; not an active V3 contract. Use `v3-error-privacy.md`.

# Error handling

Domain/application code throws typed errors with stable codes. IPC converts them to:

```ts
type AppErrorDto = {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, unknown>
}
```

Because Electron serializes thrown `ipcMain.handle` errors down to their message, validated invoke handlers return an explicit envelope instead of throwing across the process boundary:

```ts
type IpcResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppErrorDto }
```

Preload owns unwrapping. Runtime decoders run once in main before application/file services; renderer and services must not each invent a second parser.

- Preserve the cause internally; expose no stack or local secret to renderer.
- Expected errors include project-not-open, validation, path-escape, conflict, migration-required, AI-auth, rate-limit, timeout, cancelled and offline.
- Cancellation is a terminal job state, not a generic failure.
- A cancelled job ignores late Provider completion even when the adapter cannot abort promptly; terminal job states never regain a proposal.
- Failed job DTOs use an allowlisted user message. Never persist or return an unknown Provider exception message through job status.
- Renderer displays actionable recovery, never raw exception objects.
- Do not catch and silently return empty data except for explicitly optional missing files with documented defaults.
- Unknown exceptions become a generic `INTERNAL_ERROR`; never serialize their message, stack, absolute path or input payload to renderer.

For detailed-outline adoption, every preview token is optimistic concurrency control. If the total outline, target volume, selected candidate, current chapter outline, or required confirmation changes, return recoverable `CONFLICT` before any write. Do not silently refresh and continue with the author's old confirmation.

For multi-file imports, persist a project-relative manifest journal before the first destination write. A retry may skip only files durably marked `completed`; an interruption after a file enters `running` must become `review` and block automatic replay. A malformed journal is evidence, not an empty default: preserve its exact bytes and stop writing.

After an application restart, discover journals only under the current canonical project root. Rehydrate only `pending` files after verifying staged bytes against the journal SHA-256, issue fresh one-time tokens, and preserve the author's original filename in provenance. Never auto-resume `running`, `review`, or `needs-review` entries.

For manuscript saves, a history-snapshot or atomic chapter write failure is recoverable but never successful. Renderer keeps the latest in-memory draft visible, exposes an explicit retry, and blocks navigation/close that would orphan it. A stale failure from another work item or chapter cannot change current save state; a retry always flushes and submits the latest current snapshot rather than replaying the failed payload. Test fault injection is allowed only behind the isolated Electron smoke environment and must be unreachable in normal runtime.
