import { memo, type CSSProperties } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';

// 精选语言集合：按需注册，避免引入 Prism 全量语言定义（默认 ~270 种）。
// 覆盖聊天代码块与文件预览（code-viewer）所需语言。每项 = 规范名 + 语言模块 + 常见别名；
// 别名统一映射回规范名后再交给高亮器，保证只传已注册语言，
// 未命中则回退纯文本 <pre>（不会抛 Unknown language）。
const LANGUAGE_ENTRIES: Array<{ name: string; mod: unknown; aliases: string[] }> = [
  { name: 'typescript', mod: typescript, aliases: ['ts'] },
  { name: 'javascript', mod: javascript, aliases: ['js'] },
  { name: 'jsx', mod: jsx, aliases: [] },
  { name: 'tsx', mod: tsx, aliases: [] },
  { name: 'python', mod: python, aliases: ['py'] },
  { name: 'go', mod: go, aliases: [] },
  { name: 'rust', mod: rust, aliases: ['rs'] },
  { name: 'java', mod: java, aliases: [] },
  { name: 'c', mod: c, aliases: [] },
  { name: 'cpp', mod: cpp, aliases: ['c++'] },
  { name: 'csharp', mod: csharp, aliases: ['cs', 'c#'] },
  { name: 'ruby', mod: ruby, aliases: ['rb'] },
  { name: 'php', mod: php, aliases: [] },
  { name: 'swift', mod: swift, aliases: [] },
  { name: 'kotlin', mod: kotlin, aliases: ['kt'] },
  { name: 'docker', mod: docker, aliases: ['dockerfile'] },
  { name: 'bash', mod: bash, aliases: ['sh', 'shell'] },
  { name: 'json', mod: json, aliases: [] },
  { name: 'yaml', mod: yaml, aliases: ['yml'] },
  { name: 'sql', mod: sql, aliases: [] },
  { name: 'markup', mod: markup, aliases: ['html', 'xml'] },
  { name: 'css', mod: css, aliases: [] },
  { name: 'markdown', mod: markdown, aliases: ['md'] },
];

const canonicalByAlias = new Map<string, string>();
for (const { name, mod, aliases } of LANGUAGE_ENTRIES) {
  SyntaxHighlighter.registerLanguage(name, mod as never);
  canonicalByAlias.set(name, name);
  for (const alias of aliases) canonicalByAlias.set(alias, name);
}

interface CodeBlockProps {
  language: string;
  value: string;
  showLineNumbers?: boolean;
  customStyle?: CSSProperties;
}

// 按 (language, value, ...) memo：同一代码块重复渲染时复用上次高亮结果，不重复跑 Prism。
// 调用方应保持 showLineNumbers / customStyle 引用稳定以命中 memo（文件预览用模块级常量）。
export const CodeBlock = memo(function CodeBlock({ language, value, showLineNumbers, customStyle }: CodeBlockProps) {
  const canonical = canonicalByAlias.get(language);
  if (!canonical) {
    // 未注册语言：回退为可读、可复制的纯文本 <pre>，不报错、不中断渲染。
    return (
      <pre className="m-0 overflow-auto rounded-xl bg-foreground/[0.04] p-3 text-sm">
        <code>{value}</code>
      </pre>
    );
  }
  return (
    <SyntaxHighlighter
      language={canonical}
      style={oneLight}
      PreTag="div"
      className="rounded-xl text-sm"
      showLineNumbers={showLineNumbers}
      customStyle={customStyle}
    >
      {value}
    </SyntaxHighlighter>
  );
});
