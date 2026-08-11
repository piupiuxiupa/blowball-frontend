# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

React 19 + Vite + TypeScript SPA — the frontend for the **blowball** multi-agent chat backend, which lives in the sibling `../blowball` repo. Three-panel workspace: session/file sidebar · file viewer/editor · agent chat. UI text and most code comments are in **Chinese (zh-CN)**; match that when editing existing surfaces.

## Commands

```bash
npm install
npm run dev          # Vite dev server on :5173; proxies /api -> http://localhost:8080
npm run build        # tsc -b (typecheck) + vite build
npm run lint         # tsc --noEmit  (this IS the typecheck — there is no separate one)
npm run generate-api # regenerate src/lib/openapi.d.ts from openapi.yaml
```

There is **no test framework** installed (no jest/vitest/playwright). "Lint" is purely a TypeScript typecheck — that is the only static gate. To verify a change: `npm run lint`, then `npm run dev` and exercise the flow in the browser.

## API contract sync (important)

`src/lib/openapi.d.ts` is **generated**, never hand-edit it. The pipeline:

1. `openapi.yaml` at repo root is a **copy** of the backend's `api/openapi.yaml` (sibling `blowball` repo). When the backend contract changes, re-copy that file here.
2. Run `npm run generate-api` to regenerate types.
3. `src/lib/api.ts` re-exports the generated `paths` types as named request/response types (`LoginResponse`, `Message`, `FileEntry`, etc.) — add new endpoint types there, not by importing `paths` elsewhere.

## Architecture

### Two backend roles, two base URLs

The blowball backend deploys as two roles that may run on **separate ports** (`--role api|agent|all` in `cmd/blowball/serve.go`). `src/lib/api.ts` encodes this split — it is the single most non-obvious thing in the codebase:

- **API base** (`VITE_API_BASE_URL`, default :8080) — all CRUD: auth, sessions, message history, workspace files. Use `apiGet/apiPost/apiPut/apiPatch/apiDelete/apiUpload`.
- **Agent base** (`VITE_AGENT_BASE_URL`, default = API base) — the streaming message turn (`POST /sessions/:id/messages`) and MCP tool catalogue (`GET /mcp/tools`). Use `apiPostStream` and `apiGetAgent`.

`VITE_AGENT_BASE_URL` intentionally falls back to the API base so the monolith (`--role all`) and local dev keep working unchanged. Only set it for the split deployment. **When adding an endpoint, route it through the correct base** — a streaming/tools endpoint called via `apiPost` will 404 in the split deployment.

Auth is JWT Bearer. The token lives in the persisted Zustand auth store (`localStorage['blowball-auth']`); `getToken()` reads it from there and all `api*` helpers inject the header automatically.

### State management: React Query vs Zustand (deliberate split)

- **TanStack Query** = server state. A singleton `queryClient` (`src/lib/query-client.ts`) is imported by both the provider and non-component code (e.g. the streaming reconcile logic). `refetchOnWindowFocus` is **intentionally false** — refetching on focus would clobber in-progress file edits (see file editing below). Query keys to reuse: `['sessions']`, `['messages', sessionId]`, `['file-content', path]`.
- **Zustand** = client state, three stores in `src/stores/`:
  - `auth-store` — persisted (token, userId, expire, hydration flag). `userId` doubles as the office-vers versioning namespace.
  - `ui-store` — active session/file, panel widths, file view mode, **streaming segments** (see below).
  - `file-edit-store` — per-path dirty/loaded-baseline state for Monaco editing, plus the shared editor instance and dirty-guard dialog coordination.

### SSE streaming pipeline (the chat turn)

`POST /sessions/:id/messages` returns `text/event-stream`. `src/lib/sse.ts` (`parseSSEStream`) is an async generator splitting on `\n\n` boundaries. `src/hooks/use-send-message.ts` consumes events and drives the UI:

- Events: `agent_start`, `token`, `reasoning`, `tool_call` (name in `content`, args in `meta.args`), `tool_result` (`content` is a status-envelope JSON string; `status===1` → red), `agent_end`, `agent_error`, `done`.
- **Per-agent segments**: streaming output is rendered **per agent during the stream**, not deferred to end-of-turn. `ui-store` keeps `streamingSegments[sessionId]: StreamingSegment[]` (append-only; monotonic `seg-N` ids are stable React keys). `agent_start` opens a segment; tokens append to that agent's active segment. Tokens arriving before `agent_start` lazily create a segment.
- **rAF throttling + per-agent buffers**: `token`/`reasoning` accumulate into per-agent string buffers and flush at most once per animation frame, capping renders at ≤60fps. Every terminal path (`done`/`agent_error`/abort/exception) flushes remaining buffers — losing tail tokens is a known-class bug to avoid.
- **Reconcile-on-done**: the assistant reply exists only in `streamingSegments` during the turn. `done` may fire before the backend finishes persisting, so the hook **repeatedly refetches message history until the count exceeds the pre-send baseline**, then clears the streaming segments. Clearing too early makes the reply vanish until refresh.

### File viewing & editing (center panel)

`src/lib/file-type.ts` dispatches by extension to one viewer in `src/components/files/`. `canEdit()` decides whether Monaco text-editing is offered: text/code/markdown/json/html/css yes; pdf/image/office no (office is edited through OnlyOffice, not via `canEdit`).

- **Monaco editing** (`monaco-viewer.tsx` + `file-edit-store`): dirty tracking keyed by path; the loaded baseline doubles as an **optimistic lock** (the backend `/content` endpoint has no `update_time`, so content-equality is the lock). On window focus while editing, a silent refetch detects external (Agent) changes and surfaces a **non-blocking notice** rather than overwriting local edits. Switching files with unsaved changes trips `DirtyGuardDialog` (`pendingSwitch`).
- **Binary/preview viewers** (image, pdf, html, excel via `xlsx`, word via `mammoth`) bust cache via a `refreshKey` prop; Monaco instead re-`setValue`s in place on content change (no remount).

### Office files: OnlyOffice (signed by backend) vs office-vers (direct)

Two separate integrations, both in `src/lib/`:

- **OnlyOffice** (`onlyoffice.ts`): the browser **never holds the OnlyOffice secret and never signs configs**. It calls a backend endpoint that builds + signs a `DocEditor` config and returns `{server_url, edit:{config,token}, view:{config,token}}` — both modes pre-signed because OnlyOffice signs the whole config, so mode-switching requires a fresh token, not a mutation. `api.js` is loaded once per DocumentServer origin (cached, retryable). Historical-version preview uses a view-only variant with a **stable** `document.key` (immutable → cacheable), unlike the live file's per-request random key.
- **office-vers** (`office-vers.ts`): a separate MinIO-native versioned-storage service the frontend connects to **directly (MVP: no auth)**. Namespace `{uuid}` = logged-in user id; files addressed by workspace logical path, which the service SHA-256-hashes into a storage key. **Critical**: the path is appended to the URL **raw** (browser percent-encodes deterministically) — do *not* `encodeURIComponent` the whole path, or `/` becomes `%2F` and the service hashes a different key, breaking upload/list/rollback consistency. Only the `{uuid}` is encoded.

### HTTPS enforcement (production only)

`VITE_UPGRADE_INSECURE_REQUESTS=true` injects a page-wide `upgrade-insecure-requests` CSP meta at bootstrap (`src/main.tsx`). **Never enable locally** — it rewrites `http://localhost:*` to `https://localhost:*` (no TLS listener) and breaks all local requests. Production-only; covers the OnlyOffice `api.js` load which would otherwise be mixed-content-blocked.

## Conventions

- **`@/` → `src/`** path alias (configured in `tsconfig.app.json` + `vite.config.ts`). Use it for all intra-src imports.
- **Comments explain *why*, not *what***, and frequently reference design decisions / task numbers from the OpenSpec change that introduced them (e.g. "design 决策2", "task 4.4"). Preserve these when editing — they capture non-obvious invariants (race conditions, ordering constraints, fallback rationale). Match the Chinese comment style of the surrounding file.
- **OpenSpec spec-driven workflow**: substantial changes go through `openspec/` (propose → apply → archive). Specs (`openspec/specs/<capability>/spec.md`) use **SHALL/MUST + Scenario** format and are the source of truth for behavior. Archived changes live in `openspec/changes/archive/`. Prefer reading the relevant spec before changing streaming, message rendering, file editing, versioning, or HTTPS behavior.
- **Conventional Commits** (`feat(chat): …`, `fix(files): …`, `perf`, `style`, `chore`), often with Chinese subject text.
- **Tailwind CSS v4** via `@tailwindcss/vite`; `cn()` helper (`src/lib/utils.ts`) merges `clsx` + `tailwind-merge`. Aesthetic is "iOS 26 liquid glass" (`glass` utility class, backdrop-blur panels).
- Base path is configurable via `VITE_BASE_PATH` (→ Vite `base` + React Router `basename`); root deployment is `/`.
