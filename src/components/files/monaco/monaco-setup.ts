// Monaco接入模块（自托管 worker + 精选语言）。
//
// 设计依据见 openspec/changes/monaco-text-viewer/design.md：
// - 决策1：官方 ESM + Vite `?worker` + 精选语言 contribution，零外网 CDN。
// - 决策2：只读场景只配 `editor.worker`，不注册 TS 语言服务 worker（最大体积削减点）。
//
// 本模块为副作用模块：被 `monaco-viewer.tsx`（经 React.lazy 懒加载）import，
// 因此 Monaco 整体（核心 + worker + 语言）只在首次打开文本文件时才进入会话，
// 纯聊天会话不承担其首屏与打包体积成本。

import * as monaco from 'monaco-editor/editor/editor.api';

// --- Worker：经 Vite `?worker` 自托管，URL 天然遵循动态 `base` ----------------
// `?worker` 让 Vite 把 editor.worker 单独打成产物 chunk，构造器内部用配置好的
// `base` 前缀解析 worker URL —— 非 root base（VITE_BASE_PATH）部署也不会 404。
// 只读浏览只需基础 editor worker：高亮 tokenization 在主线程，不需要 TS worker。
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  // 忽略 label：所有语言都回落到基础 editor.worker（无 hover/补全/诊断，符合只读目标）。
  getWorker() {
    return new EditorWorker();
  },
};

// --- 编辑器 contribution（精选）：折叠、文件内查找(Ctrl+F)、字号缩放 ---------
// minimap / 行号 / 换行属于编辑器核心能力，无需额外 contribution 导入。
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/features/find/register'; // 拉起 findController + findWidget
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom';

// --- 精选语言（对齐 code-block.tsx 的 Prism 别名表，而非 Monaco 全量 ~85 种）--
// 每个 register.js 注册语言 id + 惰性加载的 grammar，按需才会拉取 grammar chunk。
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/go/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/cpp/register'; // 同时注册 c + cpp
import 'monaco-editor/languages/definitions/csharp/register';
import 'monaco-editor/languages/definitions/ruby/register';
import 'monaco-editor/languages/definitions/php/register';
import 'monaco-editor/languages/definitions/swift/register';
import 'monaco-editor/languages/definitions/kotlin/register';
import 'monaco-editor/languages/definitions/dockerfile/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/sql/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/xml/register';

// 注意：html / css / json 在 Monaco 中是重量级「语言服务」（0.56 起不再有 basic-language
// 形态）。导入它们会拖入 lsp 客户端（~1MB）+ 各自专属 worker（css.worker~1MB、
// html.worker~0.7MB、json.worker~0.4MB），与「只 editor.worker、收敛体积」的目标相悖
// （见 design.md 决策2 —— 其假设的 basic-language 体积在 0.56 已不成立）。
// 因此 Monaco 仅覆盖廉价的 monarch 语言；html/css/json 改在 code-viewer 路由到现有
// Prism 只读高亮（它们本就在 Prism 别名表内，无高亮回退损失）。

// 扩展名 → Monaco languageId。对齐 Prism 别名表；未命中返回 undefined，
// 调用方据此不设语言，Monaco 以纯文本渲染（与现有 Prism「未注册回退 <pre>」一致，不报错）。
const EXTENSION_TO_LANGUAGE_ID: Record<string, string> = {
  // TypeScript / JavaScript
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  es6: 'javascript',
  // Python
  py: 'python',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Java
  java: 'java',
  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  // C#
  cs: 'csharp',
  // Ruby
  rb: 'ruby',
  // PHP
  php: 'php',
  // Swift
  swift: 'swift',
  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',
  // Docker
  dockerfile: 'dockerfile',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  // JSON / CSS / HTML 不在此列：它们是 Monaco 重量级语言服务，改由 code-viewer
  // 路由到 Prism 只读高亮（见文件顶部说明）。
  // YAML
  yml: 'yaml',
  yaml: 'yaml',
  // SQL
  sql: 'sql',
  // Markup（XML 是廉价 monarch 语言，保留；HTML 走 Prism）
  xml: 'xml',
  svg: 'xml',
  // Markdown（保持完整；.md 由上游 MarkdownViewer 渲染，实际不会进入此处）
  md: 'markdown',
  markdown: 'markdown',
};

// 取扩展名（不含点，小写）。与 lib/file-type 的 getFileExtension 行为一致。
function getExtension(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  return path.slice(idx + 1).toLowerCase();
}

export function getLanguageIdFromPath(path: string): string | undefined {
  return EXTENSION_TO_LANGUAGE_ID[getExtension(path)];
}

export { monaco };
