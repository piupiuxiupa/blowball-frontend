import type { CSSProperties } from 'react';
import { CodeBlock } from '@/components/chat/code-block';

interface CodeViewerProps {
  content: string;
  language?: string;
}

// 模块级常量：保持引用稳定，使 CodeBlock 的 memo 在文件预览重渲染时仍命中。
const VIEWER_STYLE: CSSProperties = {
  margin: 0,
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
};

export function CodeViewer({ content, language }: CodeViewerProps) {
  // 直接把扩展名/语言名交给 CodeBlock，由其别名表解析；未命中则回退纯文本。
  return (
    <div className="p-4">
      <CodeBlock
        language={language ?? ''}
        value={content}
        showLineNumbers
        customStyle={VIEWER_STYLE}
      />
    </div>
  );
}
