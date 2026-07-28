import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeViewer } from './code-viewer';

interface HtmlViewerProps {
  content: string;
  /** 文件路径：源码模式下用于扩展名→Monaco 语言解析与大文件回退。 */
  path: string;
}

type ViewMode = 'render' | 'source';

// 在中间区域直接渲染 HTML：默认 iframe 预览，可一键切回源码（复用 CodeViewer）。
// content 已由外层 useFileContent 拉取，与 MarkdownViewer 同为文本驱动；刷新走 query 失效重取。
export function HtmlViewer({ content, path }: HtmlViewerProps) {
  const [mode, setMode] = useState<ViewMode>('render');

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate">HTML {mode === 'render' ? '渲染' : '源码'} · {path}</span>
        <div className="flex items-center gap-1">
          <Button
            variant={mode === 'render' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('render')}
          >
            渲染
          </Button>
          <Button
            variant={mode === 'source' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('source')}
          >
            源码
          </Button>
        </div>
      </div>
      <div className="relative flex-1">
        {mode === 'render' ? (
          <iframe
            title="html-preview"
            // sandbox 隔离：allow-scripts 让交互式 HTML（脚本/动画）可运行；
            // 刻意不授予 allow-same-origin，被预览的页面拿到的是独立 null origin，
            // 无法访问本应用的 localStorage / cookie / 父窗口，避免工作区 HTML 里的
            // 恶意脚本窃取 token 或劫持界面。srcDoc 渲染不依赖后端 Content-Type。
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            srcDoc={content}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <CodeViewer content={content} path={path} />
        )}
      </div>
    </div>
  );
}
