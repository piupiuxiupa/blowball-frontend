## Context

工作区文件目前是 last-writer-wins、无历史（文本经 `PUT /content`、Office 经 OnlyOffice 回调，均覆盖旧内容）。新服务 **office-vers**（Go/Gin + MinIO 原生版本控制）提供按逻辑路径 + 用户 UUID 命名空间的不可变版本档案：每次 `POST /documents/{uuid}/{filepath}` 产生一个新版本，可列历史、下载指定版本、非破坏性回滚。

既有事实 / 约束（来自代码勘察）：

- 前端已有 `getDownloadUrl(path)` / `getPreviewUrl(path)`（`use-file-content.ts`），指向后端 `/api/v1/workspace/files/download/{path}?token=`，返回任意文件的**原始字节**（attachment/inline）。OnlyOffice 的 `document.url` 也走它。**因此前端能拿到任意文件的字节**——包括 Office（此前一度误以为拿不到）。
- `GET /content` 仅文本，二进制返回 `400 BINARY_FILE`；`PUT /content` 仅接受 JSON 文本体（`{content}`，NUL/二进制拒绝）；二进制写回须走 multipart `upload`（`apiUpload`）。
- dirty 仅 `file-edit-store.dirtyByPath` 维护，**只服务于 Monaco**；Office 文件由 OnlyOffice 自管存盘（forcesave → 后端 callback），前端无 dirty 概念。
- `office-viewer.tsx` 的 `refreshKey`（由 center-panel bump）可让 OnlyOffice 用新 `document.key` 重新转换——恢复内容后重挂载的现成机制。
- `auth-store.ts` 仅存 `token`/`expire`/`isAuthenticated`，**无 user id**。
- 仓库偏好精选依赖、收敛体积；UI 文案为中文，无 i18n 库。

## Goals / Non-Goals

**Goals:**
- 用户对**任意类型文件**主动「记录版本」（手动快照到 office-vers），服务不自动记录。
- 编辑器右侧可折叠抽屉按活动文件展示版本历史。
- 点列表某版本 → 只读预览（复用现有 viewer）。
- 「恢复此版本」把旧版本写回工作区工作文件。
- 前端直连 office-vers（MVP 无鉴权），以用户 id 为 `{uuid}`。

**Non-Goals:**
- ❌ office-vers 鉴权（首版直连、裸跑；CORS 须开）。
- ❌ 自动快照 / 定时版本。
- ❌ 工作区文件删除/重命名/移动时联动清理或迁移 office-vers 历史（已知限制，见下）。
- ❌ 检测 OnlyOffice 未保存改动（dirty 拦截仅对文本生效）。
- ❌ 版本对比（diff）、版本备注/命名、多用户协同。
- ❌ 修改 office-vers 服务本身（按其 v2 现状接口接入）。

## Decisions

### 决策 1：office-vers = 工作区旁边的「按需快照档案」（git 式分层）

工作区存储（last-writer-wins）与 office-vers（不可变版本）是**两层**：日常编辑不进 office-vers，只有用户点「记录版本」才把当前工作文件归档成一份快照。这天然解释了「让用户决定是否记录版本」——因为服务本就「每次上传即一版」，而**上传动作由用户按钮触发**。

```
   工作文件 (Monaco / OnlyOffice → blowball 后端)   ← 随便改、随时存、不产生历史
              │
              │  📸「记录版本」按钮 → POST /documents/{uid}/{path}
              ▼
   版本档案 (office-vers / MinIO, 不可变)            ← 仅按钮触发才多一版
              │
              │  🕘 抽屉列表 → GET ?action=versions
              │  预览        → GET ?action=version&versionId=
              │  恢复此版本  → 字节写回工作区（不新建版本）
              ▼
```

### 决策 2：快照统一走「下载端点取字节 → POST office-vers」（类型无关）

无论文本还是 Office，快照都 `fetch(getDownloadUrl(path))` 拿到当前**已落盘**内容的 Blob，再 `POST` 给 office-vers。理由：
- **类型无关、单一代码路径**：不必为文本/二进制分支（文本用 Monaco 值、Office 用下载）。
- **快照的是「已落盘」内容**，语义干净（git 的 commit 基于工作树已 add 的状态，而非内存里的脏改）。
- 文本 dirty 已被拦截（见决策 4），不 dirty 时 Monaco 值 ≡ 已落盘内容 ≡ 下载端点字节，三者一致。

字节在浏览器里过一道（后端→浏览器→office-vers），大文件多一次上下行——MVP 可接受（替代方案是后端代劳 server-side 推送，但本期定调前端直连）。

### 决策 3：前端直连 + 新客户端模块 + `VITE_OFFICE_VERS_BASE_URL`

新建 `src/lib/office-vers.ts`，base URL 取 `VITE_OFFICE_VERS_BASE_URL`（与 `VITE_API_BASE_URL` 同套 `import.meta.env` 模式）。薄封装：

| 函数 | office-vers 调用 |
|---|---|
| `uploadVersion(uid, path)` | `POST /documents/{uid}/{path}`，body = 下载端点取到的 Blob |
| `listVersions(uid, path)` | `GET /documents/{uid}/{path}?action=versions` |
| `downloadVersion(uid, path, versionId)` | `GET /documents/{uid}/{path}?action=version&versionId=` |
| `rollbackVersion(uid, path, versionId)` | `POST ...?action=rollback`，body `{versionId}`（首版用「写回工作区」实现恢复，此函数预留） |

`{filepath}` 是 catch-all、**允许带 `/`**：拼 URL 时保留路径原样斜杠，仅对含特殊字符的**单段**做必要编码（不可整段 `encodeURIComponent`，会把 `/` 编成 `%2F`）。`{uid}` 不可含 `/`。

### 决策 4：dirty 拦截仅对文本生效；Office 直取已落盘内容

- 文本：点「记录版本」时若 `dirtyByPath[path]` 为真 → **拦截**，提示「当前有未保存改动，请先保存后再记录版本」，不发请求。
- Office：前端无 dirty（OnlyOffice 自管 forcesave）→ 不拦截，快照最后一次 forcesave 落盘的内容（下载端点所服务端真值）。

此为已知限制（见 Risks），不在首版接 OnlyOffice forcesave API。

### 决策 5：`{uuid}` = 用户 id，由 login 响应带回

后端在登录响应新增 `user_id`；前端 `use-auth` 登录成功后写入 `auth-store.userId`（与 token 一同 persist）。office-vers 所有调用以该 `userId` 作 `{uuid}`。无 token 时（未登录）不提供版本入口。

### 决策 6：历史抽屉 = 编辑器右侧可折叠，按活动文件加载

抽屉挂在 center-panel 编辑区右侧，由工具条「历史」按钮开合（开合态入 ui-store）。内容按当前 `activeFilePath` 加载 `listVersions`；切换活动文件 → 抽屉重载该文件版本；无活动文件 → 空态。抽屉**不挤占** ChatPanel（ChatPanel 在更右侧独立列），而是叠在编辑区内、可收起。

```
 ┌──────────────────────────────────────┐
 │ FileToolbar  ... [📸记录版本] [🕘历史]│
 ├────────────────────────┬─────────────┤
 │                        │ 版本历史    │ ← 抽屉（可折叠）
 │      编辑器 / 预览      │ v3  现在 ●  │
 │                        │ v2  10:20   │
 │                        │ v1  昨天     │
 │                        │ [恢复此版本] │
 └────────────────────────┴─────────────┘
```

### 决策 7：预览复用现有 viewer，喂以版本 Blob

点列表某版本 → `downloadVersion` 取字节 Blob → `URL.createObjectURL(blob)` → 复用现有 viewer 只读呈现：
- 文本：只读 Monaco（或简易 pre）显示解码文本。
- 图片/PDF：object URL 直接喂 `<img>` / PDF.js。
- Office：`.docx` 走 `mammoth`、`.xlsx` 走 `xlsx`（现有 word/excel viewer 改造为可接受 Blob/URL，而非只接 path）；`.pptx`/其它二进制 → `binary-placeholder`（仅提示，可后续增强）。

预览为**只读**，不落盘、不改工作区。

### 决策 8：恢复 = 把版本字节写回工作区工作文件（文本 PUT / 二进制 upload + OO 重挂载）

「恢复此版本」取该版本字节，按类型写回工作区：
- 文本：解码为字符串 → `useWriteFileContent`（`PUT /content`）。
- 二进制 / Office：包成 `File` → `apiUpload`（multipart）覆盖同路径。
- Office 额外：bump `refreshKey` → OnlyOffice 用新 key 重新转换，反映恢复后内容（文本无此步，Monaco 可原地 setValue 或经失效重取）。

写回成功后失效 `['file-content']` 与 `['workspace']`（同保存语义）。**恢复不新建 office-vers 版本**——工作文件此刻 = 旧版内容，下次用户点「记录版本」才会归档。

> 注意：office-vers 的 `?action=rollback`（服务端非破坏性 copy 成新 latest）**首版不直接暴露给用户**——因为它只动 office-vers 档案、不碰工作区工作文件，与「恢复到编辑器所见」的用户预期不符。首版「恢复」= 上面的「字节写回工作区」。`rollbackVersion` 客户端函数预留，未来若要做「档案侧回滚」再用。

## Risks / Trade-offs

- **[CORS]** 前端跨域直连 office-vers，POST 带 body 触发预检 OPTIONS → **要求 office-vers 放行前端源**（含 `POST`、`GET`、`DELETE` 方法与 `Content-Type`）。这是 office-vers 部署侧配置，落地前须确认，否则浏览器全挡。
- **[无鉴权]** office-vers MVP 无 auth，前端直连意味着版本库对能访问到它的客户端裸露可写可删（`{uid}/{path}` 可枚举）→ 接受为 MVP 风险；生产前必须加鉴权（建议后端代理或 office-vers 加 token）。
- **[Office 无 dirty 检测]** 决策 4：Office 快照的是已 forcesave 的内容，可能略落后于 OnlyOffice 内未 flush 的编辑 → MVP 接受；未来可触发 OnlyOffice forcesave 后再快照。
- **[删除/移动孤儿]** 工作区文件删/改名/移动后，office-vers 旧路径历史变孤儿（不可见、不清理）→ MVP 接受；后续可让删除联动 `DELETE /documents/{uid}/{path}`（需前缀感知，类似 `clearUnder`）。
- **[恢复覆盖并发]** 恢复写回是 last-writer-wins（同保存），若 Agent 此刻在写同一文件可能互相覆盖 → 复用保存的重取校验逻辑（可选）；首版可先不做，与保存现状一致。
- **[pptx 预览]** 无轻量 JS 解析 → 回退 placeholder；docx/xlsx 覆盖主流场景。
- **[大文件快照]** 字节经浏览器中转，大文件上下行翻倍 → MVP 接受；超大文件后续可改后端代劳。

## Migration Plan

无数据迁移，纯前端增量 + 一处后端契约扩展（login 加 `user_id`）。回滚 = 还原前端 + 后端 login 字段（office-vers 已部署的不受影响）。可灰度：先上文本文件快照/预览/恢复，Office 预览增强随后。

## Open Questions

- office-vers 的 CORS 是否已开启？（部署侧确认，非设计阻塞）
- 抽屉默认收起还是展开？（建议默认收起，点「历史」才展开）
- 「恢复此版本」是否需要二次确认？（写回覆盖当前工作文件，建议加确认弹窗）
