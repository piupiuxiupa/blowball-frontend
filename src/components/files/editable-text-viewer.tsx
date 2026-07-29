import { Suspense, lazy } from 'react';
import { CodeViewer, MAX_MONACO_BYTES } from './code-viewer';
import { Skeleton } from '@/components/ui/skeleton';

// 编辑态文本渲染入口：懒加载 Monaco（保持「Monaco 仅在打开文本文件时进会话」的体积目标，
// 与 code-viewer 的懒加载边界对齐）。code / md / json / html / css 统一进 Monaco——
// json/html/css 因 Monaco 不注册其语言服务（避免拖入 lsp worker，见 monaco-setup），
// 以纯文本呈现（design 决策6）。大文件（>1 MiB）编辑态回退 Prism 只读并提示（task 5.3）。
const MonacoViewer = lazy(() =>
  import('./monaco-viewer').then((m) => ({ default: m.MonacoViewer }))
);

interface EditableTextViewerProps {
  path: string;
  content: string;
}

export function EditableTextViewer({ path, content }: EditableTextViewerProps) {
  if (content.length > MAX_MONACO_BYTES) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-white/50 bg-white/40 px-4 py-2 text-xs text-muted-foreground">
          文件过大（&gt; 1 MiB），不可在网页端编辑，已切换为只读查看。
        </div>
        <div className="min-h-0 flex-1">
          <CodeViewer content={content} path={path} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Suspense fallback={<Skeleton className="m-4 h-[600px] w-full" />}>
        <MonacoViewer path={path} content={content} editable />
      </Suspense>
    </div>
  );
}
