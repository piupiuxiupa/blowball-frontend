import { useUIStore } from '@/stores/ui-store';
import { useFileContent } from '@/hooks/use-file-content';
import {
  getFileExtension,
  isImage,
  isMarkdown,
  isPdf,
  isOffice,
  isHtml,
  canEdit,
} from '@/lib/file-type';
import { MarkdownViewer } from './markdown-viewer';
import { HtmlViewer } from './html-viewer';
import { CodeViewer } from './code-viewer';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './pdf-viewer';
import { BinaryPlaceholder } from './binary-placeholder';
import { OfficeViewer } from './office-viewer';
import { EditableTextViewer } from './editable-text-viewer';
import { Skeleton } from '@/components/ui/skeleton';

interface FileRendererProps {
  /** 外层「刷新」按钮 bump；强制重新加载当前文件。文本靠 query 失效重取，
   * 二进制（图片/PDF/Office）靠它做缓存破坏/重挂载。 */
  refreshKey?: number;
}

export function FileRenderer({ refreshKey }: FileRendererProps) {
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  const fileViewMode = useUIStore((s) => s.fileViewMode);
  // Office files render through OnlyOffice (binary, via the download endpoint),
  // so we skip the text-content fetch for them — otherwise /content 400s with
  // BINARY_FILE on every office open. ext is computed before the hook so it can
  // gate the query (hooks must run unconditionally).
  const ext = getFileExtension(activeFilePath ?? '');
  const editable = !!activeFilePath && fileViewMode === 'edit' && canEdit(activeFilePath);
  const { data, isLoading } = useFileContent(activeFilePath, {
    enabled: !!activeFilePath && !isOffice(ext),
    // 编辑态拉长 staleTime、关闭 refetchOnMount：避免组件重挂载时 react-query 重取
    // 覆盖 Monaco 中的本地改动（design 决策3）。查看态用默认（staleTime 0）拿最新。
    ...(editable ? { staleTime: Infinity, refetchOnMount: false } : {}),
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
  // Office 读取统一 fileViewMode 决定 edit/view（task 2.2）。
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

  // 编辑态：所有可编辑文本类型统一进 Monaco（含大文件回退），由 EditableTextViewer 处理。
  if (editable) {
    return <EditableTextViewer path={activeFilePath} content={content} />;
  }

  // 查看态分发。
  if (isMarkdown(ext)) {
    return <MarkdownViewer content={content} />;
  }

  // HTML 直接在中间区域渲染（iframe 预览），可切回源码查看（只读模式内的子切换）。
  if (isHtml(ext)) {
    return <HtmlViewer content={content} path={activeFilePath} />;
  }

  // 其余文本/代码：CodeViewer（Monaco 只读，或大文件/json·css 回退 Prism）。readOnly
  // 恒 true 作为查看态单一来源；编辑态走上方的 EditableTextViewer。
  return <CodeViewer content={content} path={activeFilePath} />;
}
