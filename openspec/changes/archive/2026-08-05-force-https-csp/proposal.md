## Why

The app is served over HTTPS in production, but some origins the browser is
told to contact are still `http://`. The most visible victim is OnlyOffice: the
backend returns the DocumentServer `server_url` as `http://…`, so the
`<script src="http://…/api.js">` load (and everything the editor then derives
from that origin — the iframe, CSS, fonts, the collaboration websocket) is
blocked as **mixed content** and the editor never renders. We need a
page-level, opt-in way to force `http` subresources to `https`.

## What Changes

- Add an **env-gated, global** `upgrade-insecure-requests` Content Security
  Policy, injected at runtime as a `<meta http-equiv="Content-Security-Policy"
  content="upgrade-insecure-requests">` element in `src/main.tsx`.
- Introduce a boolean env var (default **off**) that controls whether the meta
  is injected. Document it in `.env.example` as **production-only** — enabling
  it locally breaks `http://localhost:*` debugging because the browser rewrites
  those to `https://localhost:*` (no TLS listener) and every request fails.
- This is a **page-global** policy by design (it upgrades *all* `http`
  subresources, OnlyOffice included), not an OnlyOffice-scoped rewrite. The
  env var name reflects that global scope.

Non-code precondition (captured as an assumption in `design.md`, not work in
this change): the target endpoints — OnlyOffice DocumentServer in particular —
must already be reachable over HTTPS. `upgrade-insecure-requests` only rewrites
the scheme; it does not create a TLS listener. If DocumentServer has no HTTPS
endpoint, the upgraded `api.js` request fails and the editor breaks.

## Capabilities

### New Capabilities

- `https-enforcement`: Page-level, env-gated enforcement that upgrades
  insecure (`http://`) browser requests to `https://` via the
  `upgrade-insecure-requests` CSP directive, so an HTTPS page never issues
  mixed-content requests (e.g. to the OnlyOffice DocumentServer).

### Modified Capabilities

<!-- None. No existing spec changes behavior at the requirement level. -->

## Impact

- **Code**: `src/main.tsx` gains conditional meta-tag injection before app
  render. No other runtime code changes — existing fetch/API helpers and the
  OnlyOffice loader are untouched (the upgrade happens at the browser/CSP
  layer, below them).
- **Config**: `.env` / `.env.example` gain one boolean variable with a clear
  prod-only warning.
- **API / backend**: None. `server_url`, `document.url`, and `callbackUrl`
  continue to be backend-owned and (for the latter two) JWT-signed; this change
  does not rewrite any URL in code.
- **Ops**: Requires DocumentServer (and any other upgraded origin) to be
  HTTPS-reachable. Enabling the flag in an environment where those endpoints
  are plain-HTTP-only will break those features.
- **Dev**: Flag must stay off locally; covered by the `.env.example` note.
