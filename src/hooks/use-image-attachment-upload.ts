import { useCallback } from 'react';
import { uploadImageAttachment } from '@/lib/api';
import type { AttachmentUploadResponse } from '@/lib/api';

// add-image-attachments 发送侧编排（design D1/D2）：选题只持有 File 与本地预览，
// 上传发生在发送时——（草稿则先建会话）→ 逐张上传 → 携带 attachment_ids 发消息。

/** 契约硬限制：每条消息最多 4 张图片附件。 */
export const MAX_MESSAGE_IMAGES = 4;
/** 契约硬限制：单张图片 ≤8MiB（后端 413 FILE_TOO_LARGE 终判，此处仅预检）。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** 契约接受的四类图片（MIME 真值由后端魔数嗅探）。 */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
/** 同一白名单的集合形态：粘贴等按 MIME 过滤剪贴板条目时使用。 */
export const ACCEPTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** 输入区待发送图片：uid 是列表内稳定 key；previewUrl 为本地 blob 预览。 */
export interface PendingImageAttachment {
  uid: string;
  file: File;
  previewUrl: string;
}

// 上传缓存键：同一会话内同一文件（name+size+lastModified）重试不重复上传（D2）。
// 附件不可变且未被引用即无副作用，缓存无需失效清理；会话删除后残留的只是
// 少量内存对象，随页面生命周期回收。
function fileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

const uploadCache = new Map<string, Map<string, AttachmentUploadResponse>>();

/** 上传失败且可定位到具体文件（逐文件 alert 用）。 */
export class ImageUploadError extends Error {
  public readonly file: File;
  public readonly reason: unknown;

  constructor(file: File, reason: unknown) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    super(`图片「${file.name}」上传失败：${detail}`);
    this.name = 'ImageUploadError';
    this.file = file;
    this.reason = reason;
  }
}

export function useImageAttachmentUpload() {
  // 顺序上传（≤4 张）：错误定位清晰、任一失败立即中止（spec「上传失败中止并保留现场」）。
  return useCallback(async function uploadImages(
    sessionId: string,
    files: File[]
  ): Promise<AttachmentUploadResponse[]> {
    const cache = uploadCache.get(sessionId) ?? new Map<string, AttachmentUploadResponse>();
    uploadCache.set(sessionId, cache);
    const results: AttachmentUploadResponse[] = [];
    for (const file of files) {
      const key = fileCacheKey(file);
      const cached = cache.get(key);
      if (cached) {
        results.push(cached);
        continue;
      }
      try {
        const uploaded = await uploadImageAttachment(sessionId, file);
        cache.set(key, uploaded);
        results.push(uploaded);
      } catch (err) {
        throw new ImageUploadError(file, err);
      }
    }
    return results;
  }, []);
}
