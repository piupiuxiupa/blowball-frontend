import { getPreviewUrl } from '@/hooks/use-file-content';

interface ImageViewerProps {
  path: string;
  /** 刷新时 bump：作为缓存破坏参数附加到预览 URL，src 变化触发图片重新加载。 */
  refreshKey?: number;
  /** 覆盖预览 URL（如版本字节的 object URL）；省略则用工作区预览端点。 */
  url?: string;
}

export function ImageViewer({ path, refreshKey, url: urlOverride }: ImageViewerProps) {
  return (
    <div className="flex h-full items-start justify-center overflow-auto p-6">
      <img
        src={urlOverride ?? getPreviewUrl(path, refreshKey)}
        alt={path}
        className="max-h-full max-w-full object-contain shadow-sm"
      />
    </div>
  );
}
