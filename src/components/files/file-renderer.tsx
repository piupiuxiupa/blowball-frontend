import { useUIStore } from '@/stores/ui-store';
import { useFileContent } from '@/hooks/use-file-content';
import { getFileExtension, isImage, isMarkdown, isPdf, isOffice } from '@/lib/file-type';
import { MarkdownViewer } from './markdown-viewer';
import { CodeViewer } from './code-viewer';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './pdf-viewer';
import { BinaryPlaceholder } from './binary-placeholder';
import { OfficeViewer } from './office-viewer';
import { Skeleton } from '@/components/ui/skeleton';

interface FileRendererProps {
  /** 外层「刷新」按钮 bump；强制重新加载当前文件。文本靠 query 失效重取，
   * 二进制（图片/PDF/Office）靠它做缓存破坏/重挂载。 */
  refreshKey?: number;
}

export function FileRenderer({ refreshKey }: FileRendererProps) {
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  // Office files render through OnlyOffice (binary, via the download endpoint),
  // so we skip the text-content fetch for them — otherwise /content 400s with
  // BINARY_FILE on every office open. ext is computed before the hook so it can
  // gate the query (hooks must run unconditionally).
  const ext = getFileExtension(activeFilePath ?? '');
  const { data, isLoading } = useFileContent(activeFilePath, {
    enabled: !!activeFilePath && !isOffice(ext),
  });

  if (!activeFilePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        从左侧选择一个文件以查看内容
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  // Route binary previewers by extension before falling back to text content.
  if (isOffice(ext)) {
    return <OfficeViewer path={activeFilePath} refreshKey={refreshKey} />;
  }
  if (isPdf(ext)) {
    return <PdfViewer path={activeFilePath} refreshKey={refreshKey} />;
  }
  if (isImage(ext)) {
    return <ImageViewer path={activeFilePath} refreshKey={refreshKey} />;
  }

  // If content came back as null and there is an error, treat as binary
  const hasError = data && 'error' in data && data.error != null;
  const content = data && 'content' in data ? (data.content as string) : null;

  if (hasError || content === null) {
    return <BinaryPlaceholder path={activeFilePath} />;
  }

  if (isMarkdown(ext)) {
    return <MarkdownViewer content={content} />;
  }

  // 向 CodeViewer 传入文件路径：用于扩展名→Monaco 语言解析与大文件回退。
  // readOnly 由 CodeViewer 默认值（恒 true）作为单一来源控制。
  return <CodeViewer content={content} path={activeFilePath} />;
}
