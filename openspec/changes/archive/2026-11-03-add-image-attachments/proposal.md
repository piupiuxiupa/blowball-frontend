## Why

后端 openapi.yaml 新增了 add-image-attachments 契约（图片上传、`Message.attachments`、`SendMessageRequest.attachment_ids`、`ModelEntry.vision`），前端尚未接入：用户无法在聊天中发送图片，历史消息中的图片引用也无法渲染。需要按新契约完成整条链路适配。

## What Changes

- 输入区新增图片选择：仅 png/jpeg/webp/gif、单张 ≤8MiB、每条消息最多 4 张，选中后以本地 blob URL 预览、可移除；超过数量上限时禁止继续添加。
- 发送时上传（方案 1b）：选题阶段零网络请求；发送时按「（草稿则先建会话）→ 逐张上传 → 携带 `attachment_ids` 发消息」编排。任一上传失败则中止发送，保留文本与全部已选图片；已成功的上传结果按会话缓存，重试不重复上传。
- 消息渲染：`Message.attachments` 在用户气泡中渲染为图片缩略图，图片经 query-token URL（`GET .../attachments/{id}/content?token=…&inline=1`）加载；乐观用户消息即时携带真实附件引用。
- 非 vision 模型不做前置门控：选择器不禁用图片按钮、不显示 vision 徽标；后端 400 `MODEL_NOT_VISION` 时显式提示，输入与图片均不清空。
- 显式命名隔离：新链路统一使用 `imageAttachments` / `attachmentIds` 等命名，不与既有「上下文附加」（`useAttachmentStore` / `attachment-chips`，@ 引用的 file/dir/skill/mcp）混用概念。
- 重新生成 `src/lib/openapi.d.ts` 以纳入 `AttachmentRef`、`AttachmentUploadResponse`、`attachment_ids`、`vision` 等新契约类型。

## Capabilities

### New Capabilities

- `chat-image-attachments`: 聊天图片附件的选题与预览、发送时上传编排、`attachment_ids` 传参、历史与乐观消息渲染、上传与 vision 相关错误兜底。

### Modified Capabilities

- `session-draft-creation`: 「首条消息触发真实创建与发送」编排扩展——草稿首条带图消息须先创建会话、再上传图片、最后发消息；新增上传失败保留输入与图片的场景。

## Impact

- 契约与类型：`openapi.yaml`（已更新）、`src/lib/openapi.d.ts`（重新生成）、`src/lib/api.ts`（新增上传函数、query-token 图片 URL 构造、类型导出）。
- 输入与发送：`src/components/chat/message-input.tsx`（选图 UI 与发送编排）、`src/hooks/use-send-message.ts`（`attachment_ids` 传参、乐观消息附件）、新增图片 chips/预览组件。
- 渲染：`src/components/chat/message-list.tsx`（`MessageBlock` 携带图片附件并纳入 memo 签名）、`src/components/chat/user-bubble.tsx`（缩略图渲染）。
- 模型目录：`use-models` / 模型选择器仅消费 `vision` 字段做错误提示文案，不做事前禁用。
- 不涉及后端改动；图片 bytes 永不进入 JSON 请求体，渲染一律走 content 端点。
