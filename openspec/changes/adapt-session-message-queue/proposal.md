## Why

后端已支持把运行中会话的新消息接收入 FIFO 队列，并通过 `queued` SSE 事件、队列读取和按 run 取消接口暴露等待状态。前端仍把运行中会话整体锁定，且发送路径把每个 `X-Run-Id` 都视为当前活跃 run，无法安全地提交、展示和撤回排队消息。

## What Changes

- 同步本地后端 `api/openapi.yaml`，在实现阶段重新生成前端类型，覆盖 `SSEQueued`、`queued_count`、`SessionQueueResponse`、`QUEUE_FULL` 和取消响应中的 `queued` 状态；发送成功仍是 `200 text/event-stream`，不是 JSON 入队回执。
- 分离「会话正在运行」与「本条消息正在提交」：运行中允许编辑正文、选择模型和附加上下文/图片；发送与停止使用独立入口，上传、创建会话和等待提交确认时仍防重复提交。
- 新增按会话展示的待处理队列，依据后端 `run_id` 去重并保留 FIFO 顺序，展示正文、上下文、图片、模型及入队时间；等待消息不混入已执行的历史回合和导航锚点。
- 正确识别 `queued` 为已接受但尚未执行，不覆盖当前活跃 run；确认入队后释放等待订阅，利用队列读取和活跃 run 探测恢复等待状态、衔接后续执行。
- 支持按排队项的 `run_id` 撤回，处理撤回与开始执行的竞态；停止当前 run 不清空其他排队项。
- 保留队列关闭时的 `SESSION_BUSY` 转 attach 兼容路径，补齐队列满、请求失败、会话切换和连续 run 收尾的隔离，避免回滚新草稿或清除当前输出。

## Capabilities

### New Capabilities

- `chat-message-queue`: 运行中会话继续提交消息、基于 SSE 确认入队、独立待处理队列、刷新恢复、按项撤回及队列执行衔接。

### Modified Capabilities

- `chat-turn-lifecycle`: 区分已接收的 queued run 与正在执行的 active run；attach 期间不再禁用编辑输入；终局清理、续传和后续 run 发现按 run 身份隔离；保留 `SESSION_BUSY` 回落并明确停止只取消当前 run。

## Impact

- 契约及类型：`openapi.yaml`、`src/lib/openapi.d.ts`、`src/lib/api.ts`。
- 发送与订阅：`src/hooks/use-send-message.ts`、`src/hooks/use-turn-lifecycle.ts`、`src/lib/turn-stream.ts`、必要的运行身份状态与 SSE 消费抽取。
- 输入与展示：`src/components/chat/message-input.tsx`、新增队列查询 hook / 待处理展示组件；核对 `message-list.tsx`、消息导航和 `session-item.tsx` 的边界。
- 延续现有图片附件、附加上下文、模型选择、会话草稿和子 Agent 渲染逻辑；不引入新的生产依赖，不修改后端或部署配置。
- 后端的队列开关默认关闭，由部署方开启；前端不得把省略 `queued_count` 当成能力关闭的证明。
- 不实现队列编辑、重排、批量清空，也不迁移到新版契约同时新增的 staged 图片上传端点；现有会话内上传流程保持不变。
