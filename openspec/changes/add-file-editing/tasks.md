# Tasks

> 决策已锁定（见 `design.md`「Resolved Decisions」）：A3 统一工具条、并发校验两者都做、C1 拖拽为主、编辑态跨文件粘住、不做新建文件。

## 1. API 接入与模式基础设施

- [x] 1.1 在 `use-file-content.ts` 新增 `useWriteFileContent` mutation：`apiPut('/api/v1/workspace/files/{enc path}/content', { body: { content } })`，成功后乐观更新 `['file-content', path]` 并失效 `['workspace']`
- [x] 1.2 在 `ui-store.ts` 新增 `fileViewMode: 'view' | 'edit'`（默认 `view`）及 setter，与 `activeFilePath` 对称；**跨文件粘住**（`setActiveFile` 不重置模式）
- [x] 1.3 新增 `canEdit(path)`：文本/代码/md/json/html/css 可编辑，PDF/图片/二进制不可编辑；Office 不在此判定（走 OnlyOffice）

## 2. 统一只读/编辑工具条（A3）

- [x] 2.1 新建 center-panel 文件工具条组件：文件名 + `[只读|编辑]` 切换（`canEdit` 否则置灰/隐藏）+ 保存（仅编辑态且 dirty 可点）+ 刷新
- [x] 2.2 `office-viewer.tsx`：移除自身 `[编辑|只读]` 按钮，`mode` 改为读取 `fileViewMode`（`'edit'↔'view'`），保留刷新；其 header 信息并入工具条或精简
- [x] 2.3 `file-renderer.tsx`：按 `fileViewMode` + `canEdit` 分发到各 viewer 的 view/edit 形态（office / 文本 / md / json·html·css）

## 3. 文本编辑 + 保存

- [x] 3.1 `monaco-viewer.tsx` / `code-viewer.tsx`：`readOnly` 改由 `fileViewMode` 驱动（不再恒 `true`）；接入 dirty 计算（本地值 ≠ 载入值）
- [x] 3.2 接入保存：`Ctrl+S` + 工具条保存按钮 → `useWriteFileContent`；处理 `BINARY_FILE`/`413`/通用错误；无 dirty 时不发 PUT
- [x] 3.3 保存成功后清 dirty、刷新列表 size/update_time（依赖 1.1 的失效）

## 4. 并发安全（防覆盖 + 防抹改动）

- [x] 4.1 保存前**阻断式**重取校验：GET 该文件内容/update_time，相对载入已变 → 弹覆盖确认（design 决策 2）
- [x] 4.2 编辑态窗口聚焦**静默**重取：远端已变 → 非阻塞提示「文件已被外部修改」，不覆盖（Resolved Decisions 2）
- [x] 4.3 dirty 时抑制 `['file-content', path]` 的 `refetchOnWindowFocus` / 拉长 `staleTime`（design 决策 3）
- [x] 4.4 切换活动文件 / 关闭查看时若有 dirty → 保存/不保存/取消 拦截

## 5. Markdown / HTML·JSON·CSS 编辑态分发

- [x] 5.1 `markdown-viewer.tsx`：查看态渲染、编辑态切 Monaco 源码（复用单实例 + model 切换）
- [x] 5.2 JSON/HTML/CSS 编辑态提升至 Monaco 可写（查看态可继续 Prism / html 预览）
- [x] 5.3 大文件（>1 MiB）编辑态回退只读并提示「过大，不可在网页端编辑」

## 6. 跨目录移动 + 拖拽（C1）

- [x] 6.1 `use-workspace.ts` 的 `useRenameFile`：mutation 体按需带 `overwrite`
- [x] 6.2 文件树原生 HTML5 拖拽：节点 drag、目录为 drop 目标、根区域 drop、拖入视觉反馈；命中目录 → `new_path = dir/basename`
- [x] 6.3 碰撞处理：`409 ALREADY_EXISTS` → 覆盖确认 → `overwrite:true` 重发；`409 DEST_NOT_EMPTY` → 提示目录非空
- [x] 6.4 客户端防环：`newPath === oldPath || newPath.startsWith(oldPath + '/')` → 拦截提示
- [x] 6.5 保留并验证同目录行内改名（现有 `joinPath` 路径）仍工作；验证 `syncRenamed` 对活动文件的前缀改写

## 7. 验证与收尾

- [ ] 7.1 手动验证：编辑 + 保存往返、Markdown 查看/编辑切换、JSON/HTML 编辑态进 Monaco、大文件回退
- [ ] 7.2 验证并发安全：模拟 Agent 修改后保存触发覆盖确认；聚焦提示；dirty 抹改动防护；切走拦截
- [ ] 7.3 验证移动：拖入文件夹、跨目录、覆盖确认、目录非空拒绝、防环、活动文件改写
- [ ] 7.4 验证工具条：Office 经统一开关切换、不可编辑类型无编辑入口、保存按钮仅在编辑态 dirty 可点
- [x] 7.5 `npm run lint`（`tsc --noEmit`）与 `npm run build` 通过
- [x] 7.6 回归：只读仍为默认；Office 查看不受损；编辑态不新增语言服务 worker、体积无明显增长
