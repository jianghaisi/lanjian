> V3 status: `candidate-for-v3`. These composable details may be promoted by a bounded V3 frontend task; they are not active today.

# Composable guidelines

- Name reusable Vue composables `useXxx` and keep them feature-scoped unless shared by two or more features.
- A composable may call only the typed desktop client, never raw IPC.
- Separate persistent domain state from transient UI state such as modal visibility.
- Async composables expose `status`, typed `error`, retry/cancel and cleanup on unmount.
- Streaming subscriptions return an unsubscribe function and always clean up.
- Autosave uses debounce plus an explicit `flush()` used on navigation/window close.
