import { useEffect, useState } from 'react';
import { useVersionBlob } from '@/hooks/use-file-versioning';
import { getFileExtension, isLegacyOffice, isWord, isExcel } from '@/lib/file-type';
import { Skeleton } from '@/components/ui/skeleton';
import { DocxEditor } from './docx-editor';
import { XlsxEditor } from './xlsx-editor';
import { PptxEditor } from './pptx-editor';
import { LegacyOfficeDownload } from './legacy-office-download';

interface OfficeVersionViewerProps {
  path: string;
  versionId: string;
}

// 只读预览某个历史版本的 Office 文件（spec office-client-editors）：
// docx/xlsx/pptx 一律用客户端引擎（与实时文件同一套，view-only，强制 readOnly
// 以隔离全局 fileViewMode），版本字节来自 office-vers；legacy（doc/xls/ppt）
// 同样仅下载。
// 预览 SHALL NOT 落盘或改工作区。
export function OfficeVersionViewer({ path, versionId }: OfficeVersionViewerProps) {
  const ext = getFileExtension(path);
  const { data: blob, isLoading, error } = useVersionBlob(path, versionId);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!blob) {
      setBytes(null);
      setObjectUrl(null);
      return;
    }
    void blob.arrayBuffer().then((buf) => {
      if (cancelled) return;
      setBytes(new Uint8Array(buf));
    });
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
      setBytes(null);
      setObjectUrl(null);
    };
  }, [blob]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        加载版本失败：{error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (isLoading || !bytes) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (isLegacyOffice(ext)) {
    return <LegacyOfficeDownload path={path} versionUrl={objectUrl ?? undefined} />;
  }
  if (isWord(ext)) {
    return <DocxEditor key={versionId} path={path} bytes={bytes} readOnly />;
  }
  if (isExcel(ext)) {
    return <XlsxEditor key={versionId} path={path} bytes={bytes} readOnly />;
  }
  return <PptxEditor key={versionId} path={path} bytes={bytes} readOnly />;
}
