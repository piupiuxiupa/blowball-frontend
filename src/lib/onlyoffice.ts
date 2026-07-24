// OnlyOffice integration.
//
// All secrets and service addresses live in the backend `onlyoffice` config
// (config.yaml). The browser never holds the OnlyOffice secret and never signs
// the editor config itself — it asks the backend to build + sign a DocEditor
// config and hands `{...config, token}` straight to DocsAPI.DocEditor. See
// internal/handler/workspace.go (OnlyOfficeConfig) for the signing endpoint.

import { apiGet } from '@/lib/api';
import { getFileExtension } from '@/lib/file-type';

export type OfficeDocumentType = 'word' | 'cell' | 'slide';

// Map a file path to OnlyOffice's documentType, or null if it is not an office
// document (caller should fall back to another renderer).
export function officeDocumentType(path: string): OfficeDocumentType | null {
  const ext = getFileExtension(path);
  if (ext === 'docx' || ext === 'doc') return 'word';
  if (ext === 'xlsx' || ext === 'xls') return 'cell';
  if (ext === 'pptx' || ext === 'ppt') return 'slide';
  return null;
}

// DocEditor config the backend builds and signs. Only the fields the viewer
// reads are typed; the rest pass through to DocsAPI.DocEditor verbatim. The
// index signature keeps the object spreadable into the editor config.
export interface OnlyOfficeConfig {
  documentType: OfficeDocumentType;
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: { edit: boolean; download: boolean };
  };
  editorConfig: {
    mode: 'view' | 'edit';
    callbackUrl: string;
    // Present only in edit mode (forcesave); view mode omits customization.
    customization?: { forcesave: boolean };
    user: { id: string; name: string };
  };
  [key: string]: unknown;
}

// One signed {config, token} pair for a single editor mode (edit or view).
export interface OfficeEditorMode {
  config: OnlyOfficeConfig;
  token: string;
}

// Response from GET /api/v1/workspace/files/<path>/onlyoffice-config. The backend
// returns both edit and view configs (each with its own signature) so the browser
// can open the file in either mode without a second round-trip: OnlyOffice signs
// the whole config, so the frontend cannot switch modes by mutating a config in
// place — it must use the pre-signed edit or view token. Both modes share one
// random document.key (per request). The browser loads api.js from server_url
// and instantiates DocsAPI.DocEditor(id, {...config, token}) for the chosen mode.
export interface OfficeEditorResponse {
  server_url: string;
  edit: OfficeEditorMode;
  view: OfficeEditorMode;
}

// fetchOfficeConfig asks the backend to build + sign the DocEditor config for a
// workspace office file. The OnlyOffice secret stays server-side; the browser
// receives only the signed config + token. Authenticated via the bearer JWT that
// api.ts injects automatically.
export function fetchOfficeConfig(path: string): Promise<OfficeEditorResponse> {
  return apiGet<OfficeEditorResponse>(
    `/api/v1/workspace/files/${encodeURIComponent(path)}/onlyoffice-config`
  );
}

// --- api.js loader, cached per DocumentServer origin. ---

const apiPromises = new Map<string, Promise<void>>();

// Load DocumentServer's api.js exactly once per origin. Resolves once
// window.DocsAPI is available; rejects (and clears that origin's cache so a later
// mount can retry) on error. serverUrl is the browser-facing DocumentServer
// origin (onlyoffice.server_url from the backend config).
export function loadOnlyOfficeApi(serverUrl: string): Promise<void> {
  const base = serverUrl.replace(/\/$/, '');
  const scriptSrc = `${base}/web-apps/apps/api/documents/api.js`;
  const cached = apiPromises.get(scriptSrc);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    if (window.DocsAPI) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.onload = () => {
      if (window.DocsAPI) resolve();
      else reject(new Error('OnlyOffice api.js loaded but DocsAPI is missing'));
    };
    script.onerror = () => {
      apiPromises.delete(scriptSrc); // allow a subsequent mount to retry
      reject(new Error(`Failed to load ${scriptSrc}`));
    };
    document.head.appendChild(script);
  });
  apiPromises.set(scriptSrc, promise);
  return promise;
}
