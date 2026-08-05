## 1. Configuration

- [x] 1.1 Add `VITE_UPGRADE_INSECURE_REQUESTS` to `.env.example` with a clear
      comment: production-only, default off, and an explicit warning that
      enabling it locally breaks `http://localhost:*` requests. Do **not** set
      it in the local `.env`.

## 2. Runtime CSP injection

- [x] 2.1 In `src/main.tsx`, before `createRoot(...).render(...)`, read
      `import.meta.env.VITE_UPGRADE_INSECURE_REQUESTS`. When truthy, construct a
      `<meta>` element with `http-equiv="Content-Security-Policy"` and
      `content="upgrade-insecure-requests"` and append it to `document.head`.
      When unset/falsy, do nothing (no CSP, no URL rewriting anywhere).

## 3. Verification

- [x] 3.1 `npm run lint` (`tsc --noEmit`) passes with the change.
- [x] 3.2 With the flag unset, run `npm run dev` and confirm the app boots
      normally and the document `<head>` contains **no** `upgrade-insecure-requests`
      meta (behavior unchanged).
- [x] 3.3 With the flag set truthy (temporarily, local), confirm via browser
      devtools that the `upgrade-insecure-requests` meta is present in `<head>`
      at bootstrap and app boot is otherwise unaffected; then unset it again.
- [x] 3.4 (Environment-dependent, manual) On an HTTPS deployment where OnlyOffice
      DocumentServer is HTTPS-reachable, confirm the OnlyOffice editor mounts
      without mixed-content blocking when the flag is enabled. If DocumentServer
      is not HTTPS-reachable, do **not** enable the flag (see design assumption).
