## Why

工作区文件是 last-writer-wins、**无历史**：文本/Office 文件一旦保存就覆盖旧内容，用户改坏了无法回到之前的版本。现已有一个独立服务 **office-vers**（基于 MinIO 原生版本控制，按逻辑路径 + 用户 UUID 命名空间存不可变快照）可提供版本化存储。本期把 office-vers 接入前端，让用户对**任意类型文件**按需「快照一个版本」、在右侧抽屉里浏览历史版本、只读预览旧版本、并在需要时把某个旧版本恢复回工作区——给文件编辑加上一层 git 式的、用户主动触发的版本档案。

## What Changes

- **记录版本（手动快照）**：文件工具条新增「记录版本」按钮，把当前工作文件内容归档为 office-vers 的一份新版本（`POST /documents/{uuid}/{filepath}`）。服务**不自动**记录版本，完全由用户决定何时快照。
  - 若文本文件有未保存改动（dirty），**拦截**并提示「当前有未保存改动，请先保存后再记录版本」。
- **版本历史抽屉**：在编辑器右侧新增可折叠抽屉，按当前活动文件展示其版本历史（时间 / 大小 / 是否最新），数据来自 `GET ?action=versions`。
- **只读预览旧版本**：点列表中某版本 → 拉取该版本字节（`GET ?action=version&versionId=`）并**只读**呈现，复用现有 viewer（文本只读 Monaco、图片/PDF 直接渲染、Office 走 mammoth/xlsx 解析）。
- **恢复此版本**：预览态下提供「恢复此版本」按钮，把该版本内容写回工作区工作文件——文本经 `PUT /content`、二进制/Office 经 multipart `upload`；Office 文件额外 bump `refreshKey` 重挂载 OnlyOffice 以反映恢复后的内容。
- **直连 office-vers（MVP 无鉴权）**：新增 `src/lib/office-vers.ts` 客户端模块 + `VITE_OFFICE_VERS_BASE_URL` 环境变量，前端直接调用 office-vers；版本命名空间的 `{uuid}` 取**用户 id**。
- **login 携带 user_id**：后端在登录响应中带回 `user_id`，前端存入 auth-store 作为 office-vers 的 `{uuid}` 来源（后端改动由后端负责，前端按契约取用）。

## Capabilities

### New Capabilities
- `file-versioning`: 用户主动的文件版本管理——手动快照当前文件为版本、按活动文件浏览版本历史、只读预览旧版本、恢复指定版本回工作区；前端直连 office-vers，以用户 id 为命名空间，所有文件类型适用。

### Modified Capabilities
<!-- 无。版本能力为纯增量，不改变现有 text-file-viewer（只读/编辑/保存/并发）的规格契约；
     restore 复用 PUT /content 与 upload 通道，但不修改其既有需求。 -->

## Impact

- **代码**
  - 新建 `src/lib/office-vers.ts`：直连 office-vers 的薄客户端（`uploadVersion` / `listVersions` / `downloadVersion` / `rollbackVersion`），base URL 取 `VITE_OFFICE_VERS_BASE_URL`。
  - 新建版本历史抽屉组件（编辑器右侧、可折叠、按活动文件加载），承载版本列表 + 只读预览 + 「恢复此版本」。
  - `src/components/files/file-toolbar.tsx`：新增「记录版本」「历史」两个按钮；「记录版本」受文本 dirty 拦截。
  - `src/components/layout/center-panel.tsx`：挂载历史抽屉并管理其开合。
  - `src/stores/auth-store.ts` + `src/hooks/use-auth.ts`：新增 `userId`（来自 login 响应的 `user_id`），持久化。
  - 恢复写回：文本复用 `useWriteFileContent`（PUT /content）；二进制/Office 复用 `apiUpload`；Office 复用现有 `refreshKey` 重挂载 OnlyOffice。
- **依赖**：无新增——预览复用已引入的 `mammoth` / `xlsx` / `pdfjs-dist`；office-vers 为外部 HTTP 服务。
- **API / 后端**
  - 后端：login 响应新增 `user_id` 字段。
  - office-vers：须为前端源开启 **CORS**（`Access-Control-Allow-Origin`，含 POST + 预检 OPTIONS）；MVP **不做鉴权**（前端直连）。
- **已知限制（首版不处理）**
  - 工作区文件**删除 / 重命名 / 移动**后，其在 office-vers 的历史版本成为孤儿（按旧路径 hash 不可见），不做联动清理。
  - **Office 文件无 dirty 概念**（OnlyOffice 自管存盘）：dirty 拦截仅对文本文件生效；Office 快照的是最后一次 forcesave 后落盘的内容。
