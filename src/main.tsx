import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './lib/query-client';
import './index.css';

// Force-upgrade insecure (http://) requests to https:// on production HTTPS pages
// via a page-wide `upgrade-insecure-requests` Content Security Policy. Off by
// default; enable with VITE_UPGRADE_INSECURE_REQUESTS in the deployment env (see
// openspec change force-https-csp). Injected at bootstrap, before any on-demand
// resource — e.g. the OnlyOffice api.js script, which loads when a user opens an
// office file — is requested. MUST stay off locally: it rewrites http://localhost:*
// to https://localhost:* (no TLS listener) and breaks all local requests.
if (import.meta.env.VITE_UPGRADE_INSECURE_REQUESTS) {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = 'upgrade-insecure-requests';
  document.head.appendChild(meta);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
