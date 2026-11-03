## 1. 契约与 API 层

- [x] 1.1 运行 `npm run generate-api` 重新生成 `src/lib/openapi.d.ts`，核对 diff 仅含 `AttachmentRef`、`AttachmentUploadResponse`、`Message.attachments`、`SendMessageRequest.attachment_ids`、`ModelEntry.vision` 与既有的子 Agent 树字段
- [x] 1.2 在 `src/lib/api.ts` 导出新类型并新增 `uploadImageAttachment(sessionId, file)`（multipart POST）与 `getAttachmentContentUrl(sessionId, attachmentId)`（token + inline=1，复用 query-token 模式）

## 2. 输入区选题与预览

- [x] 2.1 新建 `image-attachment-chips.tsx`：`ComposerImageChips`（本地 blob 预览 + 逐张移除）与 `MessageImageThumbnails`（历史缩略图），与既有上下文附加 chips 并排但互不引用
- [x] 2.2 在 `MessageInput` 增加图片选择入口：accept 四类、选中即预检单张 ≤8MiB、≤4 张满额禁用、本地 state 持有（含 blob URL revoke），选题零网络请求
- [x] 2.3 输入框支持粘贴图片：textarea `onPaste` 拦截剪贴板图片文件并走同一选题管线（类型/数量/大小/去重），纯文本粘贴零影响

## 3. 发送编排

- [x] 3.1 新建 `use-image-attachment-upload.ts`：顺序上传 + 按 (sessionId, name, size, lastModified) 缓存成功结果，失败抛出可定位到具体文件的错误
- [x] 3.2 改造 `MessageInput` 发送编排：草稿先建会话 → 逐张上传（复用缓存）→ 以 `attachmentIds` 调用 `sendMessage`；任一上传失败中止且保留文本与全部图片
- [x] 3.3 `use-send-message.ts` 接受 `attachmentIds` 与 `imageAttachments`：请求体带上 `attachment_ids`，乐观用户消息携带真实 `AttachmentRef[]`，请求级失败不清图片现场

## 4. 消息渲染

- [x] 4.1 `groupMessages` 将用户行 `attachments` 复制到 `MessageBlock`，`signatureOf` 纳入附件 `id:filename` 列表
- [x] 4.2 `UserBubble` 渲染 `MessageImageThumbnails`（lazy 加载、title=filename），乐观消息与历史消息同构渲染

## 5. 错误兜底与验证

- [x] 5.1 错误提示：上传阶段 `UNSUPPORTED_IMAGE_TYPE` / `FILE_TOO_LARGE` 逐文件 alert；发送阶段 `MODEL_NOT_VISION` 对齐 `INVALID_MODEL` 处理，均不清空输入与图片
- [x] 5.2 `npm run lint` 通过；手动验证：草稿带图首发、上传失败重试复用缓存、非 vision 模型被拒后换模型重发、历史图片 token URL 渲染、附件变化触发重渲染
