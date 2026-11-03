import { memo } from 'react';
import { X } from 'lucide-react';
import { getAttachmentContentUrl } from '@/lib/api';
import type { AttachmentRef } from '@/lib/api';
import type { PendingImageAttachment } from '@/hooks/use-image-attachment-upload';

// 图片附件的两种形态（add-image-attachments；与 message-context-mentions 的
// 上下文附加 chips 是不同概念，显式命名隔离、互不引用——design D3）：
//   ComposerImageChips     — 输入区本地 blob 预览，× 逐张移除；
//   MessageImageThumbnails — 用户气泡内历史/乐观消息的只读缩略图（query-token URL）。

export const ComposerImageChips = memo(function ComposerImageChips({
  images,
  onRemove,
}: {
  images: PendingImageAttachment[];
  onRemove: (uid: string) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {images.map((image) => (
        <span key={image.uid} className="relative" title={image.file.name}>
          <img
            src={image.previewUrl}
            alt={image.file.name}
            className="h-14 w-14 rounded-lg border border-white/60 bg-white/50 object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(image.uid)}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/60 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-destructive"
            title="移除"
            aria-label={`移除图片 ${image.file.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
});

// 用户气泡内缩略图：附件内容不可变（ETag=id），token URL 可安全命中浏览器缓存；
// loading=lazy 避免长历史一次拉全量图片。
export const MessageImageThumbnails = memo(function MessageImageThumbnails({
  sessionId,
  attachments,
}: {
  sessionId?: string | null;
  attachments?: AttachmentRef[];
}) {
  if (!sessionId || !attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pb-1.5">
      {attachments.map((attachment) => (
        <img
          key={attachment.id}
          src={getAttachmentContentUrl(sessionId, attachment.id)}
          alt={attachment.filename}
          title={attachment.filename}
          loading="lazy"
          className="max-h-40 max-w-[80%] rounded-lg bg-white/15 object-contain"
        />
      ))}
    </div>
  );
});
