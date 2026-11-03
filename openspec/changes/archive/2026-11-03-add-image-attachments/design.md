## Context

后端 `openapi.yaml`（工作区未提交更新）新增 add-image-attachments 契约：`POST /api/v1/sessions/{id}/attachments`（multipart，magic-byte 嗅探，≤8MiB，仅 png/jpeg/webp/gif）、`GET .../attachments/{aid}/content?token=…&inline=1`（query-token、immutable）、`Message.attachments`（`AttachmentRef {id, filename, mime}`）、`SendMessageRequest.attachment_ids`（≤4）与 `ModelEntry.vision`。

前端现状约束：
- 会话为懒创建（session-draft-creation）：草稿零网络请求，首条消息发送时才 `POST /sessions`。
- 已存在 `useAttachmentStore` / `attachment-chips`，指 **@ 引用的上下文附加**（file/dir/skill/mcp）——与图片附件是两个概念，命名必须隔离。
- 消息列表按「内容签名」做块对象复用（`signatureOf`），新增字段不进签名会导致图片更新后 memo 不刷新。
- 发送链路的请求级错误已有分类处理：`SESSION_BUSY` 静默 attach、`INVALID_MODEL` / `INVALID_EFFORT` alert 提示。

## Goals / Non-Goals

**Goals:**
- 聊天可发送 ≤4 张图片，草稿懒创建语义不被破坏。
- 输入框支持直接粘贴剪贴板图片，与选图入口走同一管线（类型/数量/大小校验、本地预览）。
- 历史与乐观用户消息渲染图片缩略图，bytes 永不进入 JSON。
- 上传与 vision 错误有显式、可重试的失败路径。
- 新代码与既有「上下文附加」在命名与数据流上完全隔离。

**Non-Goals:**
- 不做 OS 文件拖拽入输入框（粘贴已支持；拖拽留作后续增强）。
- 不做 vision 前置门控（不禁用按钮、不显示徽标）。
- 不做图片灯箱/放大预览、压缩或重编码。
- 不处理后端孤儿附件清理（未引用的已上传附件由服务端磁盘策略兜底）。

## Decisions

### D1. 发送时上传（方案 1b），选题零网络请求
选题只持有 `File` 与本地 blob URL，不做任何请求；发送时按「（草稿则先建会话）→ 逐张上传 → 携带 `attachment_ids` 发消息」顺序编排。

备选：附图即建会话（破坏「草稿零网络请求」的既有 spec 语义）；草稿态禁用图片（体验降级）。1b 完整保留懒创建，代价是上传失败语义集中在发送阶段处理。

### D2. 上传结果按 (session, file identity) 缓存，重试不重复上传
上传成功后以 `sessionId + name + size + lastModified` 为键缓存 `AttachmentUploadResponse`。任一张失败即中止发送，保留文本与全部图片；重试时已成功项直接复用缓存 id，仅重传失败项。附件不可变且上传即孤儿安全（未被 `attachment_ids` 引用仅占磁盘、无语义副作用），因此「先上传后发送」的半途失败无清理需求。

### D3. 显式命名：`imageAttachments` / `attachmentIds`，不碰既有 attachment 命名
新文件 `image-attachment-chips.tsx`（`ComposerImageChips` / `MessageImageThumbnails`）、`use-image-attachment-upload.ts`；UI 概念统一 `imageAttachments`，契约字段引用 `attachmentIds`。既有 `useAttachmentStore` / `attachment-chips`（上下文附加）零改动，两者在输入区并排渲染但互不引用。

### D4. vision 不前置门控，仅错误兜底
非 vision 模型仍可选图发送；后端 400 `MODEL_NOT_VISION` 时 alert 提示（对齐 `INVALID_MODEL` / `INVALID_EFFORT` 处理），输入文本与图片均不清空、上传 id 缓存保留可直接换模型重发。选择器暂不显示 vision 徽标——配置缺省 `vision: false`，徽标在存量目录上大概率误导。

### D5. 图片渲染走 query-token URL，乐观消息带真实引用
`getAttachmentContentUrl(sessionId, attachmentId)` 复用 workspace preview 的 token-in-query 模式（`token` + `inline=1`）。因上传先于 `sendMessage` 完成（D1 顺序），乐观用户消息直接携带真实 `AttachmentRef[]`，与落库行同构，reconcile 无需换源。缩略图 `loading="lazy"`、`title=filename`。

### D6. 附件穿透 `MessageBlock` 并纳入 memo 签名
`groupMessages` 将用户行的 `attachments` 复制到块上，`UserBubble` 渲染缩略图；`signatureOf` 必须包含附件的 `id:filename` 列表，否则重拉取后图片变化不刷新。数量上限（4 张）是硬契约门控，满额时禁用选图按钮——这不属于 vision 前置预测。

### D7. 图片状态为输入区本地 state，随会话语义与上下文附加一致
图片仅被发送编排消费、无跨组件写入方，放 `MessageInput` 本地 state（含 revoke blob URL 清理）；切换会话不清空，与既有上下文附加行为一致。

### D8. 粘贴复用选题管线
textarea 的 `onPaste` 只拦截剪贴板中的图片文件（kind=file 且 MIME 属四类白名单），交由与文件选择器完全相同的 `addImages` 管线做去重、数量与大小预检；未命中图片的粘贴（纯文本等）不 `preventDefault`，粘贴行为零变化。

## Risks / Trade-offs

- [Token 过期后历史图片 401] → 与 workspace preview 同取舍：重新登录/刷新恢复；不在本次单独解决。
- [发送阶段才暴露类型/大小问题] → 前端 accept 过滤 + 选中时按 `File.size` 预检 8MiB，mime 真值仍以后端嗅探为准；错误 alert 明确指向具体文件。
- [上传成功但消息始终未发，形成孤儿] → 不可变附件无引用即无副作用，接受磁盘占用（D2）。
- [openapi.d.ts 重新生成会同时带入子 Agent 树字段] → 生成后核对 diff 仅含预期 schema；该半成品已在工作区且 tsc 通过。
- [并行上传提升速度] → ≤4 张顺序上传即可，错误定位与中止语义更简单。

## Migration Plan

纯前端变更：重新生成 `openapi.d.ts` → 新增上传/URL 工具 → 输入区与发送编排 → 渲染与签名 → 错误兜底；`npm run lint` 通过后合并。回滚 = revert 单个提交，无数据迁移。

## Open Questions

- 无阻塞项。拖拽图片、灯箱预览、vision 徽标留作后续增强。
