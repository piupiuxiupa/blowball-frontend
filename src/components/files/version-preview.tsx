import { useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { useVersionBlob } from '@/hooks/use-file-versioning';
import { canEdit, getFileExtension, isExcel, isImage, isPdf, isWord } from '@/lib/file-type';
import { Skeleton } from '@/components/ui/skeleton';
import { CodeViewer } from './code-viewer';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './pdf-viewer';
import { WordViewer } from './word-viewer';
import { ExcelViewer } from './excel-viewer';

interface VersionPreviewProps {
  path: string;
  versionId: string;
}

// 只读预览某个历史版本：从 office-vers 拉取该版本字节，按文件类型分发到现有 viewer。
// 文本类解码后进只读 CodeViewer；图片/PDF/Office 用 object URL 喂给对应 viewer；
// pptx 等无轻量解析的二进制回退占位提示。预览 SHALL NOT 落盘或改工作区。
export function VersionPreview({ path, versionId }: VersionPreviewProps) {
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
  if (isWord(ext)) return <WordViewer path={path} url={objectUrl} />;
  if (isExcel(ext)) return <ExcelViewer path={path} url={objectUrl} />;

  // pptx / 其它无轻量解析的二进制：占位提示（不阻塞，可后续增强）。
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <FileWarning className="h-10 w-10" />
      <p className="text-sm">该版本类型暂不支持在线预览</p>
      <p className="text-xs">{path}</p>
    </div>
  );
}
