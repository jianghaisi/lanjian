# Desktop companion shell

Portions of `src/main/modules/companion/desktop-pet-window.ts` adapt the transparent frameless
window, mouse-event forwarding and window-drag mechanisms from
[OpenDesktop-Pet](https://github.com/HanLoney/OpenDesktop-Pet/blob/main/main.js).

Copyright 2025 Loney. Licensed under Apache License 2.0; see
`OpenDesktop-Pet-Apache-2.0.txt` in this directory.

Modified for Lanjian: isolated sandboxed preload, sender validation, display-aware
coordinates, preference storage, author-window lifecycle and existing writing
status. No upstream character models, camera capture, screen monitoring, memory,
AI provider implementation or sandbox-disabling flags are included.

## Live2D Cubism Core

`public/vendor/live2d/live2dcubismcore.min.js` is the unmodified Live2D Cubism Core
redistributable and retains its upstream copyright and license header.
Copyright Live2D Inc. Its use and redistribution remain subject to the
[Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
It is not covered by an open source license for Lanjian. Publication-license
requirements depend on the applicable terms and the distributor's circumstances.

The bundled `lanjian-rig` model is project artwork, not a Live2D sample character.
No model weights or external voice datasets are included in the source snapshot.

## Package dependencies

Electron, Vue, CodeMirror, PixiJS, pixi-live2d-display, Lucide, Mammoth and other
dependencies retain their individual licenses. `package-lock.json` records the
resolved dependencies and available license metadata; installed packages contain
their own notices. The source snapshot does not vendor `node_modules`.

## Visual assets

Project artwork is supplied for the application and does not receive a separate
open source grant. The Historical Photographs of China reference image and its
two quartet derivatives are excluded from the initial GitHub snapshot. When the
local quartet texture is absent, book covers use the independently generated
`archive-observatory.png` while retaining the book title and cover layout.
See [asset provenance](../src/renderer/assets/visuals/ASSET_SOURCES.md).
