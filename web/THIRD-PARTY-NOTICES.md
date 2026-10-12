# Hosted interface third-party notices

## V3 inspiration library

BiliNote subtitle-flow adaptation and fixed optional yt-dlp/faster-whisper source
pins are documented in `third-party/inspiration-NOTICES.txt`, with the full
upstream terms beside it. LightRAG is a design reference; no LightRAG service or
embedding model is bundled. Browser/hosted builds exclude the native Python/ASR
runtime and model weights. The hosted server retains its own matching notices.

Retrieved 2026-10-05.

## Novel creation group chat (2026-10-11)

The shared Vue workspace adapts Clowder's message/member layout and mention
parser at commit `3e70e1d6805be24672e8f841861f180d20b184c2` (MIT):
https://github.com/zts212653/clowder-ai/tree/3e70e1d6805be24672e8f841861f180d20b184c2
The complete attribution is distributed as `third-party/group-chat-NOTICES.txt`.
CopilotKit's existing controlled Vue chat surface is reused. Paperclip's role,
model and activity presentation informed the design; its source is not copied.
Cat Cafe tutorials are research references only; no unlicensed source is copied.

## PixiJS and @pixi/unsafe-eval 6.5.10

Source: https://github.com/pixijs/pixijs/tree/v6.5.10

License: MIT; package license files are included in the release under `third-party/`.
The original desktop Live2D renderer uses PixiJS. Its official `@pixi/unsafe-eval`
static shader synchronizer is installed before the hosted renderer loads, so
Live2D can render with the existing strict script CSP and no JavaScript eval.
The browser build deduplicates the Pixi modules to apply this adapter to the
same ShaderSystem used by the original component.

## MengTo/threeui

Source: https://github.com/MengTo/threeui/tree/68802d5428071ada5c20db8094b1649e6bb770ed

License: MIT; full notice retained in `src/vendor/threeui/LICENSE`.

## Keduoli03/animatedlogin-react

Source: https://github.com/Keduoli03/animatedlogin-react/tree/22d90ed8e7a393670676f78aec212b592e4665c4

License: MIT; full notice retained in `src/vendor/animatedlogin-react/LICENSE`.

## soybeanjs/soybean-admin

Source: https://github.com/soybeanjs/soybean-admin/tree/d8e680d7891a582d9b6edd52703ad8cbeace3c41

License: MIT; full notice retained in `src/vendor/soybean-admin/LICENSE`.

## Adopted paths and adjustments

- ThreeUI: `src/shaders/emerald-horizon/emeraldHorizonShaders.ts`. Original GLSL retained; Vue/WebGL lifecycle adapter adds reduced motion, visibility pause, capped resolution and GPU resource disposal. Community source only; no remote catalog artwork.
- Animated login React: `src/components/animated-characters/AnimatedCharacters.{jsx,css}`. Earlier review used the original character drawing and pointer/face animation. The active login uses the user-approved Lanjian capsule-eye image in `LanjianLoginCompanion.vue`: bounded gaze/body following, focus feedback, failure reaction and random 3–7 second blinks adapt the interaction pattern to Vue. The approved bitmap is unchanged; SVG crops animate its existing eyes independently. The React illustration remains reference material and is not imported by the published entry. OAuth remains the existing Better Auth / Linux DO flow; no password form or fake authentication is adopted. The upstream project credits arsh342/careercompass.
- SoybeanAdmin: `packages/materials/src/libs/admin-layout/*`, `packages/materials/src/types/index.ts`. Actual layout source retained with CSS module; utility classes supplied in the admin-only stylesheet. Naive UI provides real table sorting, filtering, pagination and drawer/dialog behavior. Business data, role checks, CSRF, ledger receipts and API key storage remain the existing hosted service. No template mock API, password login or fabricated users.
- `guohaolian/animatedlogin` was inspected as a reference but is not copied because a redistribution license was not identified.
