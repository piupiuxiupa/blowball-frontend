// Thin client for the **office-vers** versioned-storage service.
//
// The frontend connects DIRECTLY to office-vers (MVP: no auth). The version
// namespace `{uuid}` is the logged-in user's id (see auth-store.userId). Files
// are addressed by their workspace logical path (`{filepath}`), which the
// service hashes (SHA-256, verbatim bytes) into a flat storage key — so upload
// and download/list/rollback MUST send the exact same path bytes.
//
// `{filepath}` is an OpenAPI catch-all that may itself contain `/`-separated
// segments. We therefore build the URL with the path left RAW (the browser
// percent-encodes non-ASCII/special chars deterministically); we do NOT
// `encodeURIComponent` the whole path (that would turn `/` into `%2F` and the
// service would hash a different key). `encodeURIComponent` is only applied to
// the `{uuid}` (a user id, never contains `/`).
//
// See the office-vers openapi (docs/openapi.yaml) for the action matrix:
//   GET  ?action=versions            list version history
//   GET  ?action=version&versionId=  download a specific version
//   POST                              upload a new version (body = raw bytes)
//   POST ?action=rollback            non-destructive rollback (body {versionId})

const RAW_BASE = (import.meta.env.VITE_OFFICE_VERS_BASE_URL || '').replace(/\/$/, '');

export interface VersionEntry {
  versionId: string;
  lastModified: string;
  size: number;
  isLatest: boolean;
  isDeleteMarker?: boolean;
}

export interface VersionsResponse {
  uuid: string;
  path: string;
  versions: VersionEntry[];
}

export interface UploadVersionResponse {
  versionId: string;
  lastModified: string;
}

export function getOfficeVersBase(): string {
  if (!RAW_BASE) {
    throw new Error('VITE_OFFICE_VERS_BASE_URL 未配置');
  }
  return RAW_BASE;
}

export function isOfficeVersConfigured(): boolean {
  return !!RAW_BASE;
}

// Build /documents/{uuid}/{filepath} preserving the filepath's slashes. The
// filepath is appended verbatim; the browser encodes it consistently across
// all operations so the service hashes the same key each time.
function documentUrl(uuid: string, filepath: string): string {
  return `${getOfficeVersBase()}/documents/${encodeURIComponent(uuid)}/${filepath}`;
}

// Upload the given bytes (Blob) as a new version of the logical path.
export async function uploadVersion(
  uuid: string,
  filepath: string,
  body: Blob,
): Promise<UploadVersionResponse> {
  const res = await fetch(documentUrl(uuid, filepath), { method: 'POST', body });
  if (!res.ok) {
    throw new Error(`记录版本失败：${res.status} ${res.statusText}`);
  }
  return (await res.json()) as UploadVersionResponse;
}

// List version history for the logical path. A 404 (file never snapshotted) is
// normalized to an empty version list so callers render an empty state.
export async function listVersions(uuid: string, filepath: string): Promise<VersionsResponse> {
  const url = new URL(documentUrl(uuid, filepath));
  url.searchParams.set('action', 'versions');
  const res = await fetch(url.toString());
  if (res.status === 404) return { uuid, path: filepath, versions: [] };
  if (!res.ok) throw new Error(`获取版本历史失败：${res.status}`);
  return (await res.json()) as VersionsResponse;
}

// Download a specific version's bytes.
export async function downloadVersion(
  uuid: string,
  filepath: string,
  versionId: string,
): Promise<Blob> {
  const url = new URL(documentUrl(uuid, filepath));
  url.searchParams.set('action', 'version');
  url.searchParams.set('versionId', versionId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`下载版本失败：${res.status}`);
  return res.blob();
}

// Non-destructive rollback (server-side CopyObject → new latest). Reserved for
// future use; the MVP "restore" is implemented client-side as a write-back of
// the version bytes to the workspace working file (see use-file-versioning).
export async function rollbackVersion(
  uuid: string,
  filepath: string,
  versionId: string,
): Promise<{ versionId: string }> {
  const url = new URL(documentUrl(uuid, filepath));
  url.searchParams.set('action', 'rollback');
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
  if (!res.ok) throw new Error(`回滚失败：${res.status}`);
  return (await res.json()) as { versionId: string };
}
