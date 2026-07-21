# blowball-frontend

React 19 + Vite + TypeScript frontend for the [blowball](../blowball) multi-agent chat backend.

## Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server on :5173, proxies /api -> http://localhost:8080
npm run build      # type-check (tsc -b) + production build
npm run lint       # type-check only (tsc --noEmit)
npm run preview    # preview the production build
```

Copy `.env.example` to `.env` and adjust `VITE_API_BASE_URL` / `VITE_AGENT_BASE_URL` / `VITE_BASE_PATH` as needed.

## API types

TypeScript types are generated from [`openapi.yaml`](openapi.yaml) into `src/lib/openapi.d.ts`:

```bash
npm run generate-api
```

**Keeping the contract in sync:** `openapi.yaml` is a copy of the backend's `api/openapi.yaml` (in the sibling `blowball` repo). When the backend API contract changes, re-copy that file here and run `npm run generate-api` to regenerate the types.
