import { Suspense, lazy } from 'react';
import type { CSSProperties } from 'react';
import { CodeBlock } from '@/components/chat/code-block';
import { Skeleton } from '@/components/ui/skeleton';
import { getFileExtension } from '@/lib/file-type';

// 大文件守卫：内容超过此阈值时回退到 Prism 只读高亮，不实例化 Monaco，
// 避免 Monaco 在多 MB 文件上卡顿/拒绝渲染。以字符数（≈ ASCII 字节数）度量，
// 对源码场景是安全近似，且无需为超大文件额外做编码计数。
export const MAX_MONACO_BYTES = 1024 * 1024; // 1 MiB

// 这些扩展名在 Monaco 中是重量级「语言服务」（会拖入 lsp 客户端 + 数 MB 专属 worker，
// 与「只 editor.worker、收敛体积」目标相悖），改走现有 Prism 只读高亮。它们本就在
// Prism 别名表内，无高亮回退损失。其余精选 monarch 语言走 Monaco。
const PRISM_ONLY_EXTENSIONS = new Set(['html', 'htm', 'css', 'json', 'jsonc']);

// 懒加载：仅当渲染文本文件时才拉取 Monaco chunk，纯聊天会话不为此付首屏/体积代价。
const MonacoViewer = lazy(() =>
  import('./monaco-viewer').then((m) => ({ default: m.MonacoViewer })),
);

interface CodeViewerProps {
  content: string;
  /** 文件路径：用于扩展名→语言解析与大文件回退。 */
  path: string;
  /**
   * 只读开关，单一来源驱动（默认 true）。未来「编辑 + 保存」只需翻转此值
   * 并接入保存数据流，查看器骨架不变。
   */
  readOnly?: boolean;
}

// 模块级常量：保持引用稳定，使 CodeBlock 的 memo 在文件预览重渲染时仍命中。
const VIEWER_STYLE: CSSProperties = {
  margin: 0,
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
};

function MonacoFallback() {
  return <Skeleton className="m-4 h-[600px] w-full" />;
}

export function CodeViewer({ content, path, readOnly = true }: CodeViewerProps) {
  const usePrismFallback =
    content.length > MAX_MONACO_BYTES || PRISM_ONLY_EXTENSIONS.has(getFileExtension(path));

  // 超阈值，或属于 Monaco 重量级语言服务的扩展名：回退现有 Prism 只读高亮（CodeBlock）。
  if (usePrismFallback) {
    return (
      <div className="p-4">
        <CodeBlock
          language={getFileExtension(path)}
          value={content}
          showLineNumbers
          customStyle={VIEWER_STYLE}
        />
      </div>
    );
  }

  return (
    <div className="h-full">
      <Suspense fallback={<MonacoFallback />}>
        <MonacoViewer path={path} content={content} readOnly={readOnly} />
      </Suspense>
    </div>
  );
}
