## Why

工作区文件目前只能看、不能改：文本/代码文件经 Monaco 恒以只读打开（`readOnly` 写死 `true`），没有保存通道；文件只能在**原目录内**行内改名，不能跨目录移动。后端已就绪两条接口——`PUT /files/{path}/content`（整文件原子写、create-or-replace）与增强后的 `PUT /files/{path}`（move/rename 新增 `overwrite` 与「拖入文件夹」语义）——且 `text-file-viewer` 规范在本期之前就预留了「只读开关翻转即编辑」的**前向契约**（`monaco-viewer.tsx` 注释明示翻转 `readOnly` + 接保存即可，骨架不动）。本期把文本文件接通编辑/保存、并补齐跨目录移动，让工作区文件真正可编辑、可组织。

Office 文件（docx/xlsx/pptx）的只读/编辑已在上期（`45e3939 feat(files): add OnlyOffice edit/view mode toggle`）完成，本期不再触及。

## What Changes

- **只读/编辑模式**：文本/代码/JSON/HTML/CSS/Markdown 文件新增「只读 ⇄ 编辑」切换；编辑态 Monaco 可写，Markdown 查看态渲染、编辑态切源码；PDF/图片/二进制不提供编辑入口。
- **内容保存**：编辑态经 `Ctrl+S` / 保存按钮 → `PUT /files/{path}/content` 整文件原子写；带 dirty 标记，处理 `BINARY_FILE`（含 NUL 字节）/ `413`（超限）错误。
- **并发安全**：落盘前重取校验，避免静默覆盖 Agent（`xizhi_write_file`）的并发写入；编辑期抑制该文件的后台重取，防止 react-query 重取抹掉本地未保存改动；切走/关闭带未保存改动时拦截确认。
- **跨目录移动**：文件/目录支持在文件树中拖拽实现「拖入文件夹」移动；目标已存在时覆盖确认；保留原目录内行内改名。
- **覆盖与防环**：move/rename 复用 `PUT /files/{path}` 并按需发送 `overwrite`；将目录移入自身子树在客户端即拒绝。

只读仍为默认，全部为增量能力，无破坏性变更。

## Capabilities

### New Capabilities
- `workspace-file-move`: 工作区内文件/目录的跨目录移动与重命名——拖入文件夹手势、目标已存在时的覆盖语义、目录移入自身子树的防环、移动后对活动文件与缓存的前缀感知同步。

### Modified Capabilities
- `text-file-viewer`: 兑现预留的前向契约——只读开关从「固定只读」改为由统一来源驱动的「只读/编辑」模式（默认只读），并新增编辑落盘、并发安全、dirty 拦截、Markdown/HTML/JSON/CSS 编辑态分发等需求。

## Impact

- **代码**
  - `src/components/files/file-renderer.tsx`：引入「只读/编辑」模式与 `canEdit` 分类，按模式 + 类型分发到可写编辑器或现有查看器。
  - `src/components/files/monaco-viewer.tsx` / `code-viewer.tsx`：`readOnly` 改由模式驱动（不再恒 `true`）；接入保存数据流与 dirty 标记。
  - `src/components/files/markdown-viewer.tsx`：查看态渲染、编辑态切 Monaco 源码。
  - `src/components/files/office-viewer.tsx`：将局部 edit/view 开关上提——改为读取统一 `fileViewMode`（`'edit'↔'view'`），保留刷新、移除其自身切换按钮。
  - 新建 center-panel 文件工具条组件：承载 `[只读|编辑]` 切换、文件名、保存、刷新（决策见 design「Resolved Decisions 1」）。
  - `src/stores/ui-store.ts`：新增文件查看模式（与 `activeFilePath` 对称）；按方案可选 dirty 态。
  - `src/hooks/use-file-content.ts`：新增 `useWriteFileContent`（PUT /content）mutation；编辑期抑制重取。
  - `src/hooks/use-workspace.ts`：`useRenameFile` 增发 `overwrite`；新增移动/拖拽与覆盖确认、防环校验。
  - `src/components/workspace/file-tree.tsx`：拖拽移动、drop 目标视觉、覆盖确认弹窗。
- **依赖**：移动交互若用原生 HTML5 DnD 则无新增依赖；若选 `@dnd-kit` 等则新增（见 design 决策）。
- **API/后端**：无变更，复用本期 openapi 已就绪的 `PUT /content` 与增强后的 `PUT` rename。
- **构建**：无预期变更（编辑态沿用上期「仅 editor.worker」，不新增语言服务 worker）。
