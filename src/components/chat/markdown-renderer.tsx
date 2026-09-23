import { createContext, memo, useContext } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import { openArtifact, parseArtifactHref, type ArtifactPinContext } from '@/lib/artifact';

// turn-artifacts：点击时钉版所需的消息上下文（所属 turn 产物列表 + 块时间，
// 见 design D1/D2）。由消息块层按块注入；缺省 null = 无上下文（流式段、
// reasoning 等），产物链接退化为打开当前版本。
export const ArtifactLinkContext = createContext<ArtifactPinContext | null>(null);

// react-markdown 默认 urlTransform 只放行 http(s)/mailto 等协议，blowball: 会被
// 剥成纯文本；放行产物 scheme，其余协议维持默认（https 外链行为不变）。
const urlTransform: NonNullable<React.ComponentProps<typeof ReactMarkdown>['urlTransform']> = (
  url,
) => (url.startsWith('blowball:') ? url : defaultUrlTransform(url));

// 产物链接：拦截点击进统一「打开产物」动作，不做浏览器跳转；普通链接原样渲染。
function ArtifactAwareLink({ href, children, ...rest }: React.ComponentProps<'a'>) {
  const ctx = useContext(ArtifactLinkContext);
  const path = href ? parseArtifactHref(href) : null;
  if (path === null) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        void openArtifact(path, ctx);
      }}
    >
      {children}
    </a>
  );
}

const components: Components = {
  a: ArtifactAwareLink,
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
      urlTransform={urlTransform}
      className={className}
    >
      {children}
    </ReactMarkdown>
  );
});
