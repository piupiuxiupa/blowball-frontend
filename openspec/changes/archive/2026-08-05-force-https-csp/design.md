## Context

The production app is served over HTTPS, but the backend hands the browser some
`http://` origins. The blocker is OnlyOffice: `GET /onlyoffice-config` returns
`server_url` as `http://…`, so `loadOnlyOfficeApi()` injects
`<script src="http://…/web-apps/apps/api/documents/api.js">`. On an HTTPS page
that is **active mixed content** — the browser blocks it and the editor never
mounts.

OnlyOffice's `api.js` is **self-origin-aware**: it derives the DocumentServer
origin from the URL it was loaded from, and every subsequent request (the editor
`<iframe>`, its CSS/fonts/images, the collaboration websocket) is relative to
that origin. So the entire mixed-content problem reduces to **one lever: the
scheme used to load `api.js`**. Make `api.js` load over HTTPS and the whole
editor chain becomes HTTPS.

This design adds a page-global, env-gated `upgrade-insecure-requests` CSP that
flips that lever (and, as a side effect, upgrades any other `http` subresource
on the page).

Current state worth noting:
- No CSP exists anywhere today (`index.html` is minimal; no meta, no header).
- `server_url` is a **sibling** of the signed config in the response
  (`{server_url, edit, view}`), **not** inside the JWT payload — so it is safe
  to influence how the browser requests it. `document.url` and
  `editorConfig.callbackUrl`, by contrast, ARE inside the signed config AND are
  DocumentServer→backend server-to-server fetches (the browser never makes
  them), so they are out of scope for any browser-side fix.
- App entry is `src/main.tsx`; OnlyOffice's `api.js` loads **on demand** (only
  when a user opens an office file), well after bootstrap.

## Goals / Non-Goals

**Goals:**
- Stop mixed-content blocking of OnlyOffice (and any other `http` subresource)
  on the HTTPS production page, via a single opt-in flag.
- Keep the mechanism entirely frontend / browser-layer — no code-level URL
  rewriting, no backend change, no JWT-signature concerns.
- Keep local development unaffected (flag off by default).

**Non-Goals:**
- Rewriting specific URLs in code (rejected "Plan B" surgical `server_url`
  rewrite — see Decisions).
- Making DocumentServer itself TLS-reachable. That is an ops/precondition, not
  frontend work.
- Changing `document.url` / `callbackUrl`. They are signed and server-to-server.
- Scoped (OnlyOffice-only) enforcement. The chosen mechanism is page-global by
  construction; scope-limiting is explicitly out of scope.

## Decisions

### Decision 1 — Global CSP `upgrade-insecure-requests` (not a surgical URL rewrite)

**Choice:** Inject `<meta http-equiv="Content-Security-Policy"
content="upgrade-insecure-requests">` page-globally, env-gated.

**Why over the alternatives:**
- *Surgical `server_url` http→https rewrite in `loadOnlyOfficeApi`* ("Plan B"):
  would work and is OnlyOffice-scoped, but the team explicitly wants a stronger,
  page-wide posture ("no `http` subresource on the prod page, period"). The
  global CSP expresses that intent directly and also future-proofs against any
  other `http` base URL (e.g. a misconfigured `VITE_*_BASE_URL`) surfacing as
  mixed content.
- *Reverse-proxy response header* (`Content-Security-Policy:
  upgrade-insecure-requests` at the edge): zero frontend code and arguably
  cleaner for a global policy, but the team wants the policy to live with the
  frontend build/env so it is version-controlled and toggleable per deployment
  via the same `.env` mechanism as the other `VITE_*` knobs. The meta-tag
  approach satisfies that.

**Caveat accepted:** the policy is global, so the env var is named for its
global effect (`VITE_UPGRADE_INSECURE_REQUESTS`), not "onlyoffice", to avoid a
misleading name.

### Decision 2 — Runtime meta injection in `main.tsx` (not build-time `index.html`)

**Choice:** In `src/main.tsx`, before `createRoot(...).render(...)`, read the
env var; if truthy, construct the `<meta>` element and append it to
`document.head`.

**Why over the alternatives:**
- *`index.html` with Vite `%VITE_X%` substitution*: Vite substitutes values into
  attribute content but cannot **conditionally include/exclude** a tag without a
  custom `transformIndexHtml` plugin hook. Runtime injection needs no plugin and
  gives a single, env-driven code path for both `dev` and `build`.
- *`transformIndexHtml` plugin*: heavier than the problem warrants; runtime
  injection is ~5 lines and equally correct given the timing (next decision).

### Decision 3 — Timing is safe because OnlyOffice loads on demand

`upgrade-insecure-requests` only affects requests made **after** the CSP is
active. `main.tsx` is the entry point and runs before React renders anything;
the OnlyOffice `api.js` script is injected only when a user opens an office
file (deep in the app). Therefore the CSP is guaranteed to be in place before
any OnlyOffice request fires. No race, no need for the meta to exist in the
static `index.html`.

### Decision 4 — Boolean env var, default OFF, production-only

**Choice:** `VITE_UPGRADE_INSECURE_REQUESTS` (boolean; truthy → on). Default
off. Documented in `.env.example` with an explicit "production-only; enabling
locally breaks `http://localhost:*`" warning.

**Why default off:** On `http://localhost:8080` etc. the directive rewrites
those to `https://localhost:8080`, which has no TLS listener, so **every** local
request fails. The flag must never be set in a developer's `.env`.

### Decision 5 — Leave all existing request code untouched

No changes to `src/lib/api.ts`, `src/lib/onlyoffice.ts`, or the OnlyOffice
viewer. The upgrade happens at the browser/CSP layer, below the application
code. This keeps the JWT-signed config (`document.url`, `callbackUrl`)
untouched and avoids any signature-invalidating URL mutation.

## Risks / Trade-offs

- **[TLS-reachability precondition]** `upgrade-insecure-requests` rewrites the
  scheme; it does not create a TLS listener. If DocumentServer (or any other
  upgraded origin) is plain-HTTP-only, the upgraded request fails and the
  feature **breaks** that integration rather than fixing it.
  → *Mitigation:* documented as a hard assumption; the flag is only enabled in
  environments where the endpoints are already HTTPS-reachable.
- **[Dev footgun]** Enabling locally silently breaks all `localhost` requests.
  → *Mitigation:* default off; loud warning in `.env.example`.
- **[CSP intersection with host headers]** A `<meta>` CSP is **combined**
  (intersection) with any CSP the hosting server emits via a response header,
  not overridden. `upgrade-insecure-requests` is additive and benign, but if the
  host sets a restrictive CSP the combination should be verified.
  → *Mitigation:* note in `.env.example`; verify in the target environment.
- **[Global scope masks misconfigurations]** Upgrading a stray `http` base URL
  in prod hides the misconfiguration instead of surfacing it.
  → *Mitigation:* accepted; arguably a feature (prevents mixed content
  regardless of cause).
- **[Meta CSP limitations]** Some directives (e.g. `report-uri`) are invalid in
  meta form, but `upgrade-insecure-requests` IS permitted in a meta tag. No
  issue here.

## Migration Plan

- Pure additive, off by default. No data migration, no API change.
- **Roll out:** set `VITE_UPGRADE_INSECURE_REQUESTS=true` in the target
  deployment's env (after confirming DocumentServer is HTTPS-reachable), redeploy.
- **Roll back:** unset the variable (or set false) and redeploy. The page
  returns to exact prior behavior (no CSP injected).

## Open Questions

1. **Is OnlyOffice DocumentServer actually HTTPS-reachable in the target
   environment?** (Hard precondition — must be confirmed before enabling.)
2. **Does the hosting layer already emit a CSP response header?** If yes, verify
   the meta-tag directive combines cleanly with it.
