# Writing plugin contracts

Pure bounded JSON contracts shared by the desktop host and the future marketplace.
No Node/Electron APIs, secrets, paths or host authorization objects belong here.

Build this package before installing/checking desktop (from this directory):

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Desktop consumes the local package's compiled `dist` exports and bundles it into
the main process output. Regenerate `dist` after source changes; it is not committed.
Manifest and contribution formats are owned by subsequent plugin tasks.
