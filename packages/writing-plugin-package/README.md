# Shared Node package reader

`readPluginPackage(bytes)` validates a bounded Lanjian ZIP in memory and returns
`{manifest,digest,unpackedBytes,files}` without extracting or executing code.

Used by the desktop installer/authoring builder and the independent marketplace.
The implementation was extracted from the already-tested desktop reader; the
desktop adapter maps errors to its safe AppError. This package depends on Node
and yauzl and must never be imported into renderer/preload or the pure
`writing-plugin-contracts` package.

Build `../writing-plugin-contracts` first, then `npm ci && npm run build` here.
Archive adversarial coverage remains in desktop writing-plugin package tests;
service tests also validate actual submitted ZIP bytes. The marketplace adds an
exact declared-file-set check beyond local installation compatibility.
