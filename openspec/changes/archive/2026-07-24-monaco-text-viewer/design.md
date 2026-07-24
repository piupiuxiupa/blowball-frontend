## Context

当前文本文件查看链路：`file-renderer.tsx` 按扩展名分发，非 office/pdf/image/markdown 的文本文件落到 `CodeViewer`，后者用 `react-syntax-highlighter`（Prism，只读）渲染，与聊天区 `code-block.tsx` 共用同一组件与精选语言表。

约束：
- 仓库偏好**精选语言、收敛打包体积**（见 `code-block.tsx` 注释：刻意只注册 23 种 Prism 语言）。
- 构建为 Vite 6 + React 19；`vite.config.ts` 的 `base` 由 `VITE_BASE_PATH` 动态决定，非根部署时静态资源/worker 路径必须遵循 `base`。
- 面向国内用户，**外网 CDN（jsdelivr 等）不可靠**，运行时拉取不可接受。
- 复用现有 `GET /content` 取文本；本期只读，无写接口（写接口不在本期）。

## Goals / Non-Goals

**Goals:**
- 文本文件以**只读 Monaco** 展示，提供 VSCode 级浏览（行号、minimap、折叠、文件内搜索、字号缩放、更完整高亮）。
- Monaco 核心 + worker **自托管**（打进应用自己的产物），零外网 CDN 依赖，路径遵循动态 `base`。
- **精选语言**：仅注册与现有 Prism 别名表对应的语言，未知扩展名回退纯文本，与仓库体积偏好一致。
- 切文件**单实例 + model 切换**，不重挂载编辑器。
- **大文件守卫**：超阈值回退 Prism 只读，避免 Monaco 卡顿。
- 组件 `readOnly` 由 prop 控制（当前恒 `true`），为未来「编辑 + 保存」留增量口。
- Monaco **按需懒加载**（仅打开文本文件时加载），不拖累纯聊天会话的首屏与体积。

**Non-Goals:**
- ❌ 文本文件编辑与保存（后端 PUT/PATCH `/content`、dirty 态、Ctrl+S、冲突处理）——后续。
- ❌ `.md` 进入 Monaco（保持 `MarkdownViewer` 渲染）。
- ❌ 聊天区代码块换 Monaco（保持 Prism）。
- ❌ office/pdf/图片/二进制的查看方式变更。
- ❌ TS/JS 的语言服务（hover、补全、诊断）——只读浏览不需要，借此砍掉最重的 ts worker。

## Decisions

### 决策 1：Monaco 接入走「官方 ESM + 精选语言 contribution + Vite `?worker`」

| 方案 | 外网依赖 | 体积控制 | base 适配 | 结论 |
|---|---|---|---|---|
| `@monaco-editor/react` 默认 CDN loader | **是（jsdelivr）** | 不进包 | n/a | ❌ 国内不可用 |
| `vite-plugin-monaco-editor` | 否 | 全量打进 | 自动 | ⚠️ Vite 6 兼容性未验证 + 语言不可精选 |
| 复制 `monaco-editor/min/vs` 到 `public/` + loader 指向 | 否 | 全量语言 ~30MB 磁盘 | 需手拼 `BASE_URL` | ❌ 体积/语言不可控 |
| **官方 ESM + `?worker` + 精选 `basic-languages/*`** | **否** | **可精选** | **自动** | ✅ 采用 |

理由：与仓库「精选语言、收敛体积」的既有哲学一致；只 import 需要的 `monaco-editor/esm/vs/basic-languages/<lang>/<lang>.contribution`，语言集合与现有 Prism 别名表一一对应；worker 经 Vite `?worker` 打包，URL 由 `import.meta.env.BASE_URL` 拼接，天然遵循动态 `base`。

### 决策 2：只读场景**不加载 TS 语言服务 worker**

只读浏览不需要 hover/补全/诊断。因此只配置 `editor.worker`（基础高亮/编辑能力），**不**注册 ts worker。这是相对「完整 Monaco」最大的体积削减点。代价：TS/JS 文件无 IntelliSense——只读浏览可接受。

### 决策 3：单常驻 `<Editor>` 实例 + model 切换

Monaco 每次创建/销毁实例代价高。`CodeViewer` 保持一个挂载的编辑器，文件切换时通过 `monaco.editor.createModel(value, language, uri)` 复用/创建 model 并 `editor.setModel()`。Monaco 按 model URI（= 文件路径）缓存 model，切回已打开文件零拷贝、状态保留。

### 决策 4：语言由**文件路径扩展名**解析，回退纯文本

`file-renderer` 已按扩展名分发。`CodeViewer` 接收 `path`，取扩展名 → 查「扩展名→Monaco 语言 id」表（复用现有别名表的别名集，映射到 Monaco 的 `languageId`，如 `yml→yaml`、`ts→typescript`、`py→python`、`sh→shell`/`shell`）。未命中 → 不设语言，Monaco 以纯文本渲染（与现有 Prism「未注册回退 `<pre>`」行为一致，不报错）。

### 决策 5：Monaco **懒加载**（动态 import）

`CodeViewer` 用 `React.lazy(() => import('./monaco-viewer'))` 包一层，仅当 dispatcher 渲染文本文件时才拉取 Monaco chunk。纯聊天会话不为此付首屏/体积代价。懒加载期间用现有 `Skeleton` 占位。

### 决策 6：大文件守卫回退 Prism

`useFileContent` 已返回完整文本。在 `CodeViewer`（或 `file-renderer`）按内容长度判断：超过阈值 `MAX_MONACO_BYTES`（初定 **1 MiB**，可调）→ 直接渲染现有 `<CodeBlock>`（Prism 只读），不实例化 Monaco。阈值以下 → 走 Monaco。

### 决策 7：`readOnly` 作为 prop（前向兼容）

`CodeViewer` 的 Monaco `options.readOnly` 由 prop 驱动（来自单一来源，当前恒 `true`）。内容仍由 `useFileContent`（react-query）供给。未来「编辑 + 保存」= 新增 `useSaveFile` mutation + `Ctrl+S` + dirty 指示 + 保存后 invalidate，**组件骨架不动**。

## Risks / Trade-offs

- **[Monaco 即便精选语言仍比 Prism 重]** → 缓解：懒加载（决策 5）使非查看路径零成本；只读不加载 ts worker（决策 2）。
- **[`?worker` 在动态 `base` 下路径错误 → worker 404，编辑器降级/报错]** → 缓解：`MonacoEnvironment.getWorkerUrl`/worker URL 一律基于 `import.meta.env.BASE_URL` 拼接；非根部署手动验证。
- **[Vite 6 对 Monaco ESM worker 打包的边界情况（worker chunk 命名/跨域）]** → 缓解：实现阶段先做最小 spike（一个 .ts 文件能高亮），确认 worker 正常再扩展语言表。
- **[语言精选导致部分扩展名无高亮]** → 既有 Prism 方案同样如此；未命中回退纯文本，行为一致、可接受。后续按需补语言。
- **[大文件阈值取值主观]** → 设为常量、初定 1 MiB；过大文件即便 Prism 也重，但 Prism 只读 DOM 增长更线性，作为兜底可接受。
- **[Monaco ~50MB 硬上限]** → 由大文件守卫（远小于 50MB）提前拦截，不会触发。

## Migration Plan

- 纯前端替换，无后端/数据迁移；分发器对外行为不变（文本文件仍落到 `CodeViewer`）。
- `react-syntax-highlighter` 与 `code-block.tsx` **保留**（聊天块 + 大文件回退共用）。
- 回滚：将 `CodeViewer` 还原为 Prism `<CodeBlock>` 即可，无残留依赖（`monaco-editor` 可随后移除）。

## Open Questions

- 大文件阈值确值（1 MiB？2 MiB？）——初定 1 MiB，落地时可按实测卡顿点微调。
- 主题：先用内置 `vs`（浅色，对齐现 `oneLight`）；是否后续定义自定义主题与整体 UI 统一——留待 UI 打磨阶段。
- 是否需要「复制全部 / 下载」按钮挂在查看器工具栏——本期不做，可后续。
