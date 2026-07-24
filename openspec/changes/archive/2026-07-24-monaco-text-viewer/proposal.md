## Why

工作区内除 office/pdf/图片/二进制之外的所有文本文件（`.py`/`.ts`/`.json`/`.yml`/`.sh`/`.txt`/`.log` 等）目前通过 `react-syntax-highlighter`（Prism）做只读语法高亮，缺少 VSCode 级的浏览体验（minimap、代码折叠、文件内搜索、字号缩放、更完整的高亮）。用户希望用 Monaco Editor 提供类 VSCode 的只读浏览，同时保持打包体积可控、且不依赖外网 CDN（国内可用性）。

本期只做**只读浏览**；编辑 + 保存留待后续（故组件形状需为此预留增量升级口）。

## What Changes

- 用 **Monaco Editor（只读）** 替换 `CodeViewer` 现有的 Prism 渲染，作为文本文件默认查看器。
- 通过 Monaco **官方 ESM 入口**接入：仅注册精选语言集合（复用现有 Prism 别名表对应的语言），用 Vite 的 `?worker` 自托管 editor/ts worker，**不依赖外网 CDN**。
- `CodeViewer` 以**单个常驻 Editor 实例 + 切换 model** 的方式响应文件切换，避免每次切文件重挂载编辑器。
- `readOnly` 作为 **prop 暴露**（当前恒为 `true`），为未来「可编辑 + 保存」留增量升级口。
- 新增**大文件守卫**：文本内容超过阈值时回退到现有 Prism 只读高亮，避免 Monaco 在多 MB 文件上卡顿/拒绝渲染。
- **保持** `.md` 走 `MarkdownViewer` 渲染、聊天区代码块继续用 Prism（文件查看器与聊天高亮解耦）。

## Capabilities

### New Capabilities
- `text-file-viewer`: 工作区内非 office/图片/pdf/markdown 文本文件的只读查看行为——Monaco 接入方式、按扩展名的语言识别与回退、大文件守卫、单实例 model 切换、只读可翻。

### Modified Capabilities
<!-- 无。现有 chat-message-render 覆盖的是聊天代码块高亮；本期聊天块保持 Prism 不变，不触及该 spec 的需求。 -->

## Impact

- **代码**
  - `src/components/files/code-viewer.tsx`：从 Prism `<CodeBlock>` 重写为 Monaco `<Editor>`（只读）。
  - 新增 Monaco 接入模块：worker 环境（`MonacoEnvironment.getWorker` + `?worker`）与精选语言 contribution 注册。
  - `src/components/files/file-renderer.tsx`：向 `CodeViewer` 传入文件路径（用于语言识别/语言回退）与内容长度（用于大文件守卫）。
- **依赖**：新增 `monaco-editor`；`react-syntax-highlighter` 保留（聊天代码块 + 大文件回退共用）。
- **构建**：`vite.config.ts` 通常无需新增插件（官方 ESM + `?worker` 路线自包含），但需确认 worker/资源路径遵循动态 `base`（`VITE_BASE_PATH`），非根部署不 404。
- **API/后端**：无变更（只读，复用现有 `GET /api/v1/workspace/files/{path}/content`）。
