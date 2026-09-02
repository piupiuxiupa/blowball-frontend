/**
 * Shared office save pipeline (design D4): engine bytes -> conflict check against
 * the bytes at open -> multipart upload overwriting the same path (the backend
 * binary overwrite endpoint is a separate change; upload-to-same-path is the
 * interim route). Text-edit conflict semantics are mirrored: mismatch ->
 * blocking overwrite confirmation, cancel keeps local dirty state.
 */
import { apiUpload } from '@/lib/api';
import { getPreviewUrl } from '@/hooks/use-file-content';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type OfficeSaveOutcome = 'saved' | 'conflict-cancelled';

export async function saveOfficeFile(opts: {
  path: string;
  bytes: Uint8Array;
  /** Bytes as they were when the document was opened; null skips the check. */
  originalBytes: Uint8Array | null;
  mime: string;
}): Promise<OfficeSaveOutcome> {
  const { path, bytes, originalBytes, mime } = opts;
  if (originalBytes && originalBytes.length > 0) {
    // Cache-busted refetch of the persisted file; mismatch = remote edit.
    const res = await fetch(getPreviewUrl(path, Date.now()));
    if (res.ok) {
      const current = new Uint8Array(await res.arrayBuffer());
      if (!bytesEqual(current, originalBytes)) {
        const overwrite = window.confirm(
          '文件在打开后被其他进程修改过。覆盖远端修改？\n\n确定 = 覆盖，取消 = 保留本地改动不保存。',
        );
        if (!overwrite) return 'conflict-cancelled';
      }
    }
  }
  const fileName = path.split('/').pop();
  if (!fileName) throw new Error('无效的文件路径');
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const file = new File([bytes as BlobPart], fileName, { type: mime });
  await apiUpload('/api/v1/workspace/upload', { file, subdir: parent || undefined });
  return 'saved';
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
