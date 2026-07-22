import { memo } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';

const components: Components = {
  code(props) {
    const { children, className, node, ref, ...rest } = props;
    void node;
    void ref;
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const value = String(children ?? '').replace(/\n$/, '');

    if (language) {
      return <CodeBlock language={language} value={value} />;
    }

    return (
      <code {...rest} className={className}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <div className="overflow-auto">{children}</div>;
  },
};

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      className={className}
    >
      {children}
    </ReactMarkdown>
  );
});
