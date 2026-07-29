## Context

文本文件查看链路（见 `text-file-viewer`）：`file-renderer.tsx` 按扩展名分发，非 office/pdf/image 的文本落到 `CodeViewer` → 懒加载的 `MonacoViewer`（**单常驻实例 + model 切换**，`readOnly` 恒 `true`）；`.md` 走 `MarkdownViewer`；HTML/JSON/CSS 与超 1 MiB 大文件回退 Prism 只读。Office 文件经 `OfficeViewer`（OnlyOffice，自带 edit/view 切换 + 后端双签名 token + 保存回调），上期已交付。

约束 / 既有事实：
- `monaco-viewer.tsx:11-14` 注释明确：`readOnly` 是带独立同步 effect 的 prop，**翻转即编辑、骨架不动**——本期正是兑现它。
- `useRenameFile`（`use-workspace.ts`）已调 `PUT /files/{path}` 且 `syncRenamed` 已做**前缀感知的 activeFile 改写**；但 UI 只有 `joinPath(parentPath, trimmed)` 的同目录行内改名，且不发 `overwrite`。
- 后端 `PUT /files/{path}/content`：整文件 create-or-replace、原子（临时文件 + rename）、**纯文本（NUL→`BINARY_FILE`）**、有大小上限（413）、**无 ETag / 版本号，last-writer-wins**；openapi 自述「like xizhi_write_file」——即 Agent 用同一通道写文件。
- 工作区存储可能为共享 POSIX FS（多用户/多 Tab），且三个 Agent 会经工具写文件。**多写者并发是真实场景，不是理论**。
- 仓库偏好精选语言、收敛体积；UI 文案为中文，无 i18n 库。

## Goals / Non-Goals

**Goals:**
- 文本/代码/JSON/HTML/CSS/Markdown 获得「只读 ⇄ 编辑」模式，编辑可经 `PUT /content` 落盘。
- 默认仍只读；编辑为显式触发。
- 不静默覆盖 Agent（或他人/其它 Tab）的并发写入。
- 文件/目录可跨目录移动（拖入文件夹 + 覆盖确认），移动后活动文件与缓存正确同步。
- 复用现有 Monaco 单实例 / model 切换 / 大文件守卫，不重写查看器骨架。

**Non-Goals:**
- ❌ Office 文件编辑（上期已交付）；PDF/图片/二进制编辑。
- ❌ 多人协同编辑（CRDT/OT）、文件版本历史、真正的 ETag 乐观锁（后端未提供，本期以「重取校验 + 覆盖确认」近似，不做真锁）。
- ❌ 自动保存（见决策 1，本期不做）。
- ❌ 新建文件/文件夹（PUT /content 可顺带创建，但作为可选邻接项，默认不做——见开放议题 5）。
- ❌ 把现有 delete/upload/list 行为补齐为 spec（保持现状，另议）。
- ❌ TS/JS 语言服务（hover/补全/诊断）；编辑态仍仅基础高亮。

## Decisions

### 决策 1：编辑落盘 = 显式保存（Ctrl+S / 保存按钮）+ dirty 标记（不做自动保存）

`PUT /content` 是盲写、last-writer-wins。在多写者模型下，**显式保存**最可预测、最易回滚。编辑态维护 dirty（本地值 ≠ 载入值），保存按钮 / Ctrl+S 触发 PUT；成功后乐观更新 `['file-content']` 缓存并失效 `['workspace']`（刷新 size/update_time）。**不做防抖自动保存**——它会把并发覆盖场景变成高频无声丢数据。

错误处理：`400 BINARY_FILE`（内容含 NUL，通常是粘贴）→ 提示「内容含非法字节，无法保存为文本」；`413` → 提示超限、引导用上传；`403/404` → 常规错误。

### 决策 2：落盘前重取校验，防覆盖 Agent 写入（核心风险）

保存前（及窗口重新聚焦时）重取文件内容/`update_time`，若自载入后已变化 → 弹「文件已被修改（可能由 Agent），是否覆盖？」，确认才继续 PUT。这是对后端「无版本号」的近似乐观锁。代价：保存多一次 GET；收益：消除最危险的静默丢数据。

```
用户 Tab              Agent (xizhi_write_file)        服务端 notes.md
打开 ──GET──► "A"                                     v1 "A"
(本地编辑 "A+改动")
                      工具写 ──PUT "B"──►             v2 "B"  ← 静默覆盖
按保存 ──(先 GET 校验)──► 发现已变 "B" ≠ 载入 "A"
       弹「已被修改，是否覆盖？」 → 取消则保留 Agent 的 B ✅
```

### 决策 3：编辑期抑制后台重取（修一个既有的隐性 bug）

`monaco-viewer.tsx:76-79` 在 react-query `content` 变化时 `model.setValue(content)` —— 若编辑中途后台重取（如窗口聚焦默认 refetch），**本地未保存改动会被直接抹掉**。进入编辑态（或有 dirty）时，对该 `['file-content', path]` 关闭 `refetchOnWindowFocus` / 拉长 `staleTime`；退出编辑或保存后再恢复。

### 决策 4：移动复用 `useRenameFile`，补 `overwrite` + 拖入文件夹

move 与 rename 是同一 `PUT /files/{path}` 接口，前端已有 `useRenameFile`（含前缀感知 activeFile 同步）。扩展点：
- mutation 体按需带 `overwrite`；
- 调用方决定 `new_path`（拖拽 → 目录 + basename；行内改名 → 同目录新名）；
- `409 ALREADY_EXISTS` → 覆盖确认 → 带 `overwrite:true` 重发；`409 DEST_NOT_EMPTY`（目标是目录）→ 提示「目录非空，不支持合并」。

### 决策 5：目录移入自身子树在客户端拒绝

`PUT` 让 `reports/` 移入 `reports/sub/` 会破坏目录树。提交前在客户端做路径前缀校验：`newPath === oldPath || newPath.startsWith(oldPath + '/')` → 直接拦截并提示，不发请求。

### 决策 6：可编辑分类 + 编辑态分发

`canEdit(path)`：文本/代码/Markdown/JSON/HTML/CSS 可编辑（Office 走 OnlyOffice）；PDF/图片/二进制不可编辑（不显示编辑入口）。
- Markdown：查看态 `MarkdownViewer` 渲染，编辑态 Monaco 源码。
- JSON/HTML/CSS：查看态可继续 Prism（现状），**编辑态提升至 Monaco**（Prism 不可编辑）。
- 大文件（>1 MiB）：编辑态仍回退 Prism 只读并提示「过大，不可在网页端编辑」。

### 决策 7：模式态放 `ui-store`（与 `activeFilePath` 对称）

新增 `fileViewMode: 'view' | 'edit'`（默认 `view`），与 `activeFilePath` 同库；dirty/未保存留在 viewer 层（按文件 path 记）。编辑态**跨文件粘住**——不随切换活动文件重置；切走由 dirty 拦截（见 Resolved Decisions 4）。

## Risks / Trade-offs

- **[并发覆盖]** 后端无版本号，重取校验只是近似乐观锁（GET 与 PUT 之间仍有窗口）→ 接受该窗口；绝大多数 Agent 写入在「打开后较久」发生，会被聚焦/保存前的重取捕获。
- **[编辑期重取抹改动]** 见决策 3；若遗漏会丢未保存输入 → 严格按 dirty 抑制 refetch，并在切走时拦截。
- **[Monaco 体积]** 编辑态不新增语言服务 worker，沿用上期「仅 editor.worker」，体积不增。
- **[拖拽可访问性]** 纯拖拽对键盘用户不友好 → 行内改名保留作为键盘/精确路径；可选「移动到…」弹窗（开放议题 3）。
- **[overwrite 误覆盖]** 覆盖是破坏性 → 必须经二次确认，且只对**文件**目标生效（目录目标走 `DEST_NOT_EMPTY` 拒绝）。

## Migration Plan

无数据迁移。发布为纯增量：只读仍是默认，编辑/移动均为显式触发；可灰度（文本编辑先上，移动随后）。回滚 = 还原前端，后端接口已稳定、不受影响。

## Resolved Decisions（原开放议题）

1. **「只读/编辑」开关位置 → A3 统一中间面板工具条**：新建 center-panel 文件工具条承载 `[只读|编辑]` 切换（`canEdit` 为否则置灰/隐藏）、文件名、保存（编辑态且 dirty 可点）、刷新；把 `office-viewer` 的局部 edit/view 开关上提——改为读取统一 `fileViewMode`（`'edit'↔'view'`），保留刷新、移除其自身切换按钮。借此收口已成三套的 ad-hoc 切换（office edit/view、html preview/source、新文本编辑）。html 的 preview/source 子切换在「只读」模式内保留。
2. **并发校验时机 → 两者都做**：保存前**阻断式**重取校验（决策 2，必须确认）；额外在编辑态窗口聚焦时**静默**重取，若远端已变则以非阻塞提示「文件已被外部修改」，SHALL NOT 自动覆盖。
3. **移动主交互 → C1 拖拽为主 + 保留行内改名**：文件树用原生 HTML5 拖拽，目录为 drop 目标、根区域 drop 到根；行内改名作为键盘/精确路径保留。本期**不做**「移动到…」弹窗（C2）。
4. **编辑模式跨文件 → 粘住 + dirty 拦截**：`fileViewMode` 不因切换活动文件而重置；切走时若有 dirty 走「保存/不保存/取消」拦截。
5. **新建文件/文件夹 → 本期不做**：保持 Non-Goal；PUT /content 可零成本建文件的邻接项留待后续。
