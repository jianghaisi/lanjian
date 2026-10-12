export const pluginLimits = Object.freeze({
  schemaBytes: 32 * 1024,
  schemaDepth: 8,
  schemaNodes: 256,
  valueDepth: 24,
  valueNodes: 100_000,
  inputBytes: 128 * 1024,
  outputBytes: 1024 * 1024,
  modelTools: 48,
  modelSchemaBytes: 96 * 1024,
  modelSteps: 24,
  calls: 96,
  callDepth: 4,
  discoveryPage: 8
})

/** Distribution and execution ceilings, shared with package/market validators. */
export const codePluginLimits = Object.freeze({
  zipBytes: 10 * 1024 * 1024,
  unpackedBytes: 30 * 1024 * 1024,
  files: 128,
  entryBytes: 2 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  packageTools: 32,
  checkpointBytes: 64 * 1024,
  guestHeapBytes: 64 * 1024 * 1024,
  guestStackBytes: 512 * 1024,
  wasmBytes: 128 * 1024 * 1024,
  processResidentBytes: 512 * 1024 * 1024,
  sliceMs: 5000,
  invocationMs: 120_000,
  processes: 2,
  queued: 32,
  indexBytes: 4 * 1024 * 1024,
  installedPlugins: 100,
  installedVersions: 16,
  installationPlans: 16,
  installationPlanMs: 10 * 60 * 1000
})
