# Vendored from GenOffice

Source: https://github.com/genspark-ai/genoffice
Upstream commit: `93b8938c456eb1194ad8dc505ec5d1398f4e5654`
License: Apache-2.0 (see [LICENSE](./LICENSE))

Packages vendored:

- `docx-engine/` — docx parsing → Block tree (docxIndex anchors + passthrough),
  OOXML fragment generation, byte-preserving paragraph-patch save.
- `pptx-engine/` — pptx model, parsing, and part generation.
- `pptx-render/` — data-driven RenderTree (EMU→px, opentype.js text metrics).

## Local modifications (browser adaptation)

Only boundary-level changes are made here; engine internals stay upstream:

- Cross-package imports rewritten from `@genoffice/*` to relative paths.
- Node-only APIs replaced with browser equivalents (`node:zlib` → pako,
  `node:crypto` → WebCrypto/uuid helpers) — see `pptx-engine/browser-compat.ts`.
- Node `Buffer` global is polyfilled at runtime by the app's
  `src/lib/office/engine-polyfills.ts` (official `buffer` package), not patched
  into vendored files.
- Unused-symbol/implicit-any fixes required by the app's stricter tsc settings:
  `docx-engine/chart.ts` (removed unused const), `pptx-engine/zip.ts`
  (`private readonly zip` → `readonly zip`), `pptx-render/build-chart.ts` +
  `scene3d.ts` (unused map params), `pptx-engine/slide-transfer.ts` (callback
  param type). App tsconfig bumped to ES2022 for `replaceAll`/`Intl.Segmenter`.
- Pptx parsing entry points exposed as pure functions over `Uint8Array`
  (no Electron/IPC).

Do NOT freely edit vendored files; record every change in this README and keep
the upstream commit in sync when re-vendoring.
