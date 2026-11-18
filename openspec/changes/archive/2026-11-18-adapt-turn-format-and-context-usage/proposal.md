## Why

后端最新契约增加了每轮产物格式偏好和普通会话的持久化上下文用量快照；前端目前既无法提交 `output_format`，也没有展示或刷新上下文余量的入口。需要同步生成类型并补齐这两条用户链路，同时保持现有流式输出、FIFO 排队和草稿保护语义不变。

## What Changes

- 根据已同步的 `openapi.yaml` 重新生成 `src/lib/openapi.d.ts`，在 `src/lib/api.ts` 集中导出产物格式与上下文快照类型。
- 在聊天输入区增加“自动 / HTML / Word / PowerPoint / PDF / Excel / Markdown”本轮格式选择；自动模式省略 `output_format`，具体选择使用 `html/docx/pptx/pdf/xlsx/md` canonical 值。
- 格式选择按单次提交捕获，服务端接受后恢复自动，请求被拒绝时保留；旧请求的迟到结果不得清除用户随后在其他会话做出的新选择。立即执行与排队提交携带同一份请求快照。
- 明确格式仅是“本轮确实需要产物时”的条件性偏好，不强制普通问答生成文件；补充 `INVALID_OUTPUT_FORMAT` 的既有非弹窗错误提示分类。
- 为普通会话增加 `GET /api/v1/sessions/{session_id}/context-usage` 查询和聊天头部轻量用量指示，按 `context_tokens / input_budget_tokens` 展示使用占比，并提供剩余量、模型和测量时间。
- 在打开、聚焦和 turn 收尾后刷新用量；收尾刷新按刚完成的 `run_id` 有界核对重取，避免 `done` 与 usage 落库非原子导致长期停留在上一轮。`available:false` 时显示明确的无快照状态，不伪造数值，也不整体隐藏上下文入口。
- 修复历史主 Agent 名 `Confuse` 被当作子 Agent 触发行的问题：它与当前 `Confucius` 都应直接渲染正文，避免旧会话只剩“已完成”标题而没有内容。
- 删除会话时清理对应上下文查询缓存。定时任务会话、草稿哨兵和流式 token 渲染不接入该端点。

## Capabilities

### New Capabilities

- `turn-artifact-format-selection`: 聊天输入区的当轮产物格式选择、请求映射、一次性消费与错误保留语义。
- `session-context-usage`: 普通会话持久化上下文快照的查询、预算口径展示、不可用语义和终局刷新。

### Modified Capabilities

- `chat-message-queue`: 运行中继续提交的参数快照增加当轮产物格式；排队接受和失败保护同样适用于该选择，但不新增队列格式展示或第二套队列状态。
- `chat-message-render`: 主 Agent 的差异化正文渲染增加历史名称 `Confuse` 兼容，不得把旧主回答误归类为无正文的子 Agent 触发行。

## Impact

- API 契约：`src/lib/openapi.d.ts` 由命令重新生成；`src/lib/api.ts` 新增命名类型，不手改生成文件。
- 发送链路：`src/components/chat/message-input.tsx`、`src/hooks/use-send-message.ts`；流式 POST 继续使用 agent base。
- 用量链路：新增上下文查询/展示模块，接入 `src/components/layout/chat-panel.tsx`、`src/hooks/use-turn-lifecycle.ts` 和会话删除缓存清理；CRUD 查询使用 API base。
- 规格：`chat-message-queue` 的提交快照要求扩展，其余流式分段、历史 reconcile、产物展示与定时任务行为不变。
- 测试：补充上下文快照匹配/有界重取的 Node 回归，执行完整 `npm run lint`、`npm test`，并浏览器验证请求体与刷新时序。
- 依赖：不新增生产或测试依赖。
