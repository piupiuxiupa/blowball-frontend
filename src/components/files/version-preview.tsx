import { useEffect, useState } from 'react';
import { canEdit, getFileExtension, isImage, isOffice, isPdf } from '@/lib/file-type';
import { Skeleton } from '@/components/ui/skeleton';
import { CodeViewer } from './code-viewer';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './pdf-viewer';
import { OfficeVersionViewer } from './office-version-viewer';
import { useVersionBlob } from '@/hooks/use-file-versioning';

interface VersionPreviewProps {
  path: string;
  versionId: string;
}

// 只读预览某个历史版本：按文件类型分发。
// - Office 文件（docx/xlsx/pptx 及 legacy）整体委托给 OfficeVersionViewer（客户端
//   引擎只读渲染）；本组件不为 Office 拉取版本字节。
// - 文本/图片/PDF 由 MediaVersionPreview 从 office-vers 拉取版本字节后渲染。
// 预览 SHALL NOT 落盘或改工作区。
export function VersionPreview({ path, versionId }: VersionPreviewProps) {
  const ext = getFileExtension(path);
  if (isOffice(ext)) {
    return <OfficeVersionViewer path={path} versionId={versionId} />;
  }
  return <MediaVersionPreview path={path} versionId={versionId} />;
}

// 文本/图片/PDF 历史版本预览：拉取版本字节；文本类解码后进只读 CodeViewer，
// 图片/PDF 用 object URL 喂给对应 viewer。
function MediaVersionPreview({ path, versionId }: VersionPreviewProps) {
  const { data: blob, isLoading, error } = useVersionBlob(path, versionId);
  const ext = getFileExtension(path);
  const isText = canEdit(path);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setObjectUrl(null);
      setText(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    if (isText) {
      blob
        .text()
        .then((t) => !cancelled && setText(t))
        .catch(() => !cancelled && setText(''));
    } else {
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setObjectUrl(null);
      setText(null);
    };
  }, [blob, isText]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        加载版本失败：{error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (isText) {
    if (text === null) {
      return (
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    return <CodeViewer content={text} path={path} readOnly />;
  }

  if (!objectUrl) return null;

  if (isImage(ext)) return <ImageViewer path={path} url={objectUrl} />;
  if (isPdf(ext)) return <PdfViewer path={path} url={objectUrl} />;

  return null;
}
