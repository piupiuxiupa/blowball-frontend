# Proposal: adapt-turn-detach-resume

## Why

后端 turn-detach-resume 变更已落地（契约已复制进 `openapi.yaml` 并重新生成类型）：SSE 连接断开不再取消生成、取消改为显式端点、运行中会话互斥（409 `SESSION_BUSY`）、支持按 run id attach 续传。当前前端仍是旧语义——**停止按钮只断开连接**（在新后端下 turn 继续运行、token 继续消耗）、abort 即丢弃流式分段（而显式取消后部分输出**会**持久化）、完全没有 attach / 409 / 410 处理。这是一次行为回归，必须同步适配。

同时工作区压着 subagent-run-identity 的在飞适配（流式分段与历史分组按 (agent, run_id) 复合键路由），与本变更共享同一批文件（`use-send-message.ts`、`ui-store.ts`、`message-list.tsx`），一并收尾落地，避免两次重构同一链路。

## What Changes

- **BREAKING（前端行为）**：停止按钮从「本地 `abort()` + 清空流式分段」改为「`POST /sessions/:sid/turns/:rid/cancel`」；本地 `AbortController` 语义降级为**仅 detach**（本端停止观看，turn 继续跑完）。
- 取消后走既有 reconcile（重拉确认落库再清分段）而非回滚乐观消息——显式取消的部分输出会持久化，用户消息不回滚。
- 捕获并跟踪本轮 run id：`X-Run-Id` 响应头 / 首个 `agent_start` 的 `meta.run_id`（发送路径）、409 body（撞忙路径）、session list entry 的 `run_id`（reload 发现路径）。
- 新增 attach 流：打开 `generating: true` 的会话时自动接入 `GET /sessions/:sid/turns/:rid/events`；`sse.ts` 暴露 `id:` 行以支持 `Last-Event-ID` 事件粒度续传；410（保留窗口已过）回落普通历史读取。
- 409 `SESSION_BUSY` 处理：`ApiRequestError` 携带 body 中的 `run_id`，静默转为 attach。
- 事件消费循环（现有 switch 分发 + rAF 缓冲）抽成共享函数，send 流与 attach 流复用（后端两路共用同一订阅循环，帧格式一致）。
- 会话列表 `generating` 徽标 + 运行中会话的取消入口；`['sessions']` 查询单独开启 `refetchOnWindowFocus`（全局关闭是为保护文件编辑，sessions 不碰文件内容），使 detach 后回到页面能感知 turn 结束。
- api 层新增：非流式 agent-base POST helper（cancel 走 agent 分区，现有 `apiPost` 走 API base，分体部署下会 404）、流式 GET helper（events，支持 `Last-Event-ID` 请求头）、`TurnStatusResponse` 等类型 re-export。
- 收尾在飞的 subagent-run-identity 适配：修复 `use-send-message.ts` 复合键分隔符中的裸 NUL 字节（统一为空格，对齐 `message-list.tsx` 与注释），消除 git 二进制识别。

## Capabilities

### New Capabilities

- `chat-turn-lifecycle`：客户端 turn 生命周期管理——run id 的捕获与跟踪、显式取消（含取消后部分输出的收尾）、attach/续传（打开 generating 会话、Last-Event-ID、410 回落）、409 撞忙转 attach、会话列表 generating 指示与取消入口、本地断开 = 仅 detach 的语义。

### Modified Capabilities

- `chat-streaming-render`：「流式收尾立即刷新缓冲」中的用户中止行为重写——中止拆分为**显式取消**（调用 cancel 端点、继续消费至终局 `done`、走 reconcile 保留部分输出）与 **detach**（仅停止观看、不清状态）；「流式按 agent 分段渲染」的分段键从 agent 名扩展为 (agent, run_id) 复合键（并发同名子 agent 调用各自成段）。
- `chat-message-render`：「按 agent 差异化渲染助手消息」的子 agent 气泡粒度细化到调用身份——并发同名子 agent 调用（同 agent、不同 run_id）的交错行各自归组为独立气泡，不再拼入同一气泡。

## Impact

- **代码**：`src/hooks/use-send-message.ts`（重构：共享事件循环、cancel、attach）、`src/lib/api.ts`（两个新 helper + 类型 re-export + `ApiRequestError` 扩展）、`src/lib/sse.ts`（`id:` 行）、`src/stores/ui-store.ts`（run id / attach 状态）、`src/components/sessions/session-list.tsx` + `session-item.tsx`（generating 徽标、取消入口）、`src/components/chat/message-input.tsx`（停止按钮语义）、`src/components/chat/message-list.tsx`（(agent, run_id) 分组收尾）。
- **契约**：`openapi.yaml` 已同步、`src/lib/openapi.d.ts` 已重新生成（前置完成，本变更不含后端改动）。
- **后续衔接**：懒会话创建与 per-request-model 适配（各自独立 change）都叠在 send 链路上，与本变更串行实施；本变更把 send 编排参数保持对象形状（`{sessionId, content}`），为后续扩展留位。
