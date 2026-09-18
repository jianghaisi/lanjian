> V3 status: `candidate-for-v3`. This target layout is not the current accepted renderer structure. Use `v3-renderer-boundaries.md`.

# Directory structure

```text
src/
├─ app/             shell, navigation and app bootstrap
├─ features/        library, planning, story-bible, writing, search, jobs, settings
├─ components/      reusable presentational primitives
├─ composables/     reusable renderer behavior
├─ styles/          tokens, reset and global styles
└─ types/           renderer-only view types
```

Each feature owns its views, view models/composables and components. No monolithic `AppShell.vue` may remain after the prototype phase. Renderer imports shared contract types only; it never imports Node or Electron runtime modules.
