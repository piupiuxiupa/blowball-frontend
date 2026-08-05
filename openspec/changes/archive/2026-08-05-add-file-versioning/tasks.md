# Tasks

> 决策已锁定（见 `design.md`）：office-vers 为工作区旁的按需快照档案；前端直连（MVP 无鉴权）；`{uuid}`=用户 id（login 带回）；快照统一走下载端点取字节；dirty 拦截仅文本生效；预览复用现有 viewer；恢复=字节写回工作区（不新建版本）。

## 1. 基础设施：office-vers 客户端与 user_id 接入

- [x] 1.1 `.env.example` 增 `VITE_OFFICE_VERS_BASE_URL`（默认 `http://localhost:8080`）；在 `src/lib` 读取 env base
- [x] 1.2 新建 `src/lib/office-vers.ts`：薄客户端——`uploadVersion(uid,path)` / `listVersions(uid,path)` / `downloadVersion(uid,path,versionId)` / `rollbackVersion(uid,path,versionId)`（预留）；`{filepath}` 拼接**保留斜杠**、仅按需对单段编码（不可整段 `encodeURIComponent`）
- [x] 1.3 `auth-store.ts` 增 `userId` 字段并随 token persist；`use-auth.ts` 登录成功后从响应写入 `user_id`
- [x] 1.4 后端 login 响应新增 `user_id` 后，更新本地 `openapi.yaml` 并 `npm run generate-api` 重生成类型；`LoginResponse` 取用 `user_id`
- [x] 1.5 确认 office-vers 已对前端源开启 CORS（含 `POST`/`GET`/`DELETE` 方法与 `Content-Type`，及预检 OPTIONS）——部署侧验证项（需运行 office-vers，留给用户验证）

## 2. 记录版本（手动快照）

- [x] 2.1 `useSnapshotVersion` mutation：`fetch(getDownloadUrl(path))` → Blob → `office-vers.uploadVersion(uid, path)`；成功提示「已记录版本」
- [x] 2.2 `file-toolbar.tsx` 增「记录版本」按钮（所有文件类型可用）；无 `userId` 时不显示入口
- [x] 2.3 文本 dirty 拦截：`file-edit-store.dirtyByPath[path]` 为真 → 提示「当前有未保存改动，请先保存后再记录版本」，**不发请求**
- [x] 2.4 Office 文件不判 dirty，直接快照已落盘（forcesave）内容

## 3. 版本历史抽屉

- [x] 3.1 `ui-store.ts` 增 `versionDrawerOpen`（默认 `false`）+ setter
- [x] 3.2 `useFileVersions(path)` query：`office-vers.listVersions(uid, path)`；`404` / 空 → 返回空列表（不报错）
- [x] 3.3 新建抽屉组件：版本列表（时间 / 大小 / 是否最新）+ 空态「暂无版本」+ loading / error 态
- [x] 3.4 `file-toolbar.tsx` 增「历史」按钮 toggle 抽屉开合
- [x] 3.5 `center-panel.tsx` 挂载抽屉（编辑区右侧、可折叠）；切换活动文件 → 抽屉重载该文件版本；收起时不挤占 ChatPanel

## 4. 只读预览历史版本

- [x] 4.1 `useVersionBlob(path, versionId)` query：`downloadVersion` → Blob → `URL.createObjectURL`；卸载时 `revokeObjectURL`
- [x] 4.2 点击列表某版本 → 进入预览态并标记当前预览版本
- [x] 4.3 预览呈现分发：文本只读、图片/PDF 直接渲染、`.docx`→mammoth、`.xlsx`→xlsx；`.pptx`/其它二进制 → 占位提示
- [x] 4.4 改造现有 `word-viewer` / `excel-viewer` 可接受 Blob / object URL（而非只接 `path`）
- [x] 4.5 预览不落盘：退出预览 / 切换版本 SHALL NOT 改动工作区工作文件与 office-vers

## 5. 恢复指定版本回工作区

- [x] 5.1 预览态「恢复此版本」按钮 + 二次确认弹窗（将覆盖当前工作文件）
- [x] 5.2 文本恢复：Blob 解码为字符串 → `useWriteFileContent`（`PUT /content`）；成功后失效 `['file-content']` 与 `['workspace']`
- [x] 5.3 二进制 / Office 恢复：Blob 包成 `File` → `apiUpload`（multipart）覆盖写回同路径
- [x] 5.4 Office 恢复成功后 bump `refreshKey` → OnlyOffice 用新 `document.key` 重新转换
- [x] 5.5 验证恢复**不**在 office-vers 新建版本（仅工作区工作文件被覆盖）

## 6. 验证与收尾

- [x] 6.1 手动验证：记录版本往返、抽屉开合 / 切换重载 / 空态、预览各文件类型、恢复文本 / 二进制 / Office（需运行完整技术栈，留给用户）
- [x] 6.2 验证边界：文本 dirty 拦截、Office 无 dirty 直取已落盘、未登录无入口（需运行，留给用户）
- [x] 6.3 验证恢复后：OnlyOffice 重挂载呈现恢复内容、不新增版本、缓存正确失效（需运行，留给用户）
- [x] 6.4 `npm run lint`（`tsc --noEmit`）与 `npm run build` 通过
- [x] 6.5 回归：现有文本编辑/保存/并发、OnlyOffice 查看/编辑、ChatPanel 布局均不受损（需运行，留给用户）
