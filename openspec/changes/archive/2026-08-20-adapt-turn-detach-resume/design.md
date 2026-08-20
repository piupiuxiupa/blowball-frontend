# Design: adapt-turn-detach-resume

## Context

后端 turn-detach-resume 已上线：turn 生命周期由服务端 run registry 持有，SSE 连接只是事件日志（Redis Stream）的订阅者；发起连接（`POST /messages`）与恢复连接（`GET /turns/:rid/events`）共用同一条订阅循环，帧格式完全一致（`id:` 行 + `event:` + `data:`，`X-Run-Id` 响应头）。契约已同步（`openapi.yaml` 复制、`openapi.d.ts` 重新生成完毕）。

前端现状（`src/hooks/use-send-message.ts`）：事件消费 switch + rAF 缓冲都在 mutation 内联；`abort()` = 断开 fetch + 清空流式分段（旧语义"断开即取消"）；无 run id 概念、无 attach、无 409/410 处理。工作区另有 subagent-run-identity 的在飞适配（分段/分组按 (agent, run_id) 复合键），与本变更重构同一批文件。

关键约束：
- 两个新端点都在 **agent 分区**（`service-roles` delta）——cancel 是非流式 POST，现有 `apiPost` 走 API base，分体部署下会 404。
- 409 互斥是尽力而为（Redis 故障降级放行），前端不得把"未收到 409"当作绝对无并发。
- 取消端点幂等且三态（本进程立即 / 他副本 ≤ 心跳周期 / 死 run 强清），所有路径都有终局 `done`——前端 fire-and-forget 取消即可，无需为"取消后流不关"设计超时。

## Goals / Non-Goals

**Goals:**
- 停止按钮真正取消 turn（显式 cancel），取消后部分输出正确落显（reconcile 而非丢弃）
- reload / 撞忙后能接入运行中 turn（attach），410/404 回落历史
- send 流与 attach 流共用一套事件消费实现
- 会话列表呈现 generating 状态并提供取消入口
- 收尾 subagent-run-identity 在飞适配（NUL 分隔符修复）

**Non-Goals:**
- 不做懒会话创建（独立 change）
- 不做 per-request-model 的模型选择 UI 与参数（独立 change）
- 不做 SSE 事件格式、分段渲染模型（(agent, run_id) 已在飞完成）之外的渲染重构
- 不为"turn 结束"做推送/轮询——靠 `['sessions']` focus refetch + 打开会话时的失效重取

## Decisions

### D1: 停止按钮 = 显式取消；AbortController 降级为"仅 detach"

`handleStop` 改为 `cancelTurn(sessionId, runId)`（fire-and-forget 的 `POST /turns/:rid/cancel`），**不**再本地 abort。取消后后端会经现有流下发终局事件，前端继续消费到 `done`，走既有 `reconcileHistory`——部分输出已持久化，不能清分段、不能回滚乐观用户消息（现有 `onError` 的回滚仅保留给请求级失败；cancel 不是失败路径）。

本地 `abortControllerRef` 保留，但语义收窄为**清理用途**（组件卸载、会话被删）：仅断开 fetch，不清流式分段（分段由 done/attach/会话切换收敛）。

*备选*：cancel 后立即本地 abort + 清分段。否决——会丢掉部分输出的落库展示，且取消是异步三态（他副本 ≤5s），本地立刻清理会在"还在生成"与"已显示取消"之间出现状态错位。

### D2: run id 的四路获取，统一存放 ui-store

`ui-store` 新增 `turnRuns: Record<sessionId, { runId: string; lastEventId: string | null }>`：

| 路径 | 来源 | 时机 |
|---|---|---|
| 发送 | `X-Run-Id` 响应头（兜底：首个 `agent_start` 的 `meta.run_id`） | 流建立时 |
| 撞忙 | 409 body 的 `error.run_id` | `SESSION_BUSY` catch 时 |
| reload 发现 | session list entry 的 `run_id`（仅 `generating: true` 时存在） | 打开会话时 |
| 续传 | 上次订阅记录的 `lastEventId` | 流异常重连时 |

*备选*：localStorage 持久化。否决——后端已在 list entry 提供 reload 发现路径，客户端持久化成为冗余状态源。

### D3: 事件消费循环抽共享函数，send 与 attach 复用

现有 mutation 内的事件 switch（含 rAF 复合键缓冲、终局 flush）整体抽为 `consumeTurnStream(sessionId, response, hooks)`。差异仅在**流如何建立**：

- send：`apiPostStream(POST /messages)`，外层仍是 mutation（乐观消息、onError 回滚、reconcile）
- attach：`apiGetStream(GET /turns/:rid/events, { lastEventId })`，无乐观消息，结束时同样 reconcile（attach 收到的 `done` 也可能早于落库）

消费循环内每帧更新 `lastEventId`（供重连），终局（`done` / 流自然关闭）时清理 `turnRuns[sessionId]` 并 reconcile。

### D4: api 层两个新 helper + `ApiRequestError` 扩展

- `apiPostAgent<T>(path, {body})`——非流式 POST 走 agent base（cancel 专用；与 `apiPostStream` 同源不同 Accept）
- `apiGetStream(path, { lastEventId?, signal? })`——SSE GET 走 agent base，携带 `Last-Event-ID` 请求头
- `ApiRequestError` 增加可选 `runId?: string`，`apiPostStream` 解析 409 body 时填充——现有实现只提取 `code`+`message`，会丢掉 attach 目标
- `api.ts` re-export `TurnStatusResponse`、`SessionListEntry`（含 `generating`/`run_id`）等新类型，维持"`paths` 不出 `api.ts`"惯例

### D5: `sse.ts` 暴露 `id:` 行

`SSEEvent` 增加 `id?: string`，`parseEvent` 解析 `id: ` 前缀行。这是 `Last-Event-ID` 事件粒度续传的前提（后端保证无重放/追 live 缝隙）。

### D6: attach 的触发与防重

新 hook `useAttachRun(sessionId)`（由 ChatPanel 层调用）：`activeSessionId` 变化时读 sessions 缓存，entry 满足 `generating && run_id && !turnRuns[sessionId]` 则启动 attach。防重靠 `turnRuns` 占位（React StrictMode 双执行、列表刷新重跑都会命中同一判据）。流异常（非取消、非 `done`）时以 `lastEventId` 重连 attach，指数退避、有限次（如 3 次），放弃后回落历史读取。410 与 404 同样回落：失效 `['sessions']` + 重取 `['messages', sessionId]`。

*备选*：attach 状态放 hook 内部 ref。否决——停止按钮（取消 attach 中的 run）、输入禁用判据、防重都需要跨组件可见。

### D7: 输入禁用判据从 `isPending` 扩为"本会话有活跃 turn"

`MessageInput` 的 `disabled` 判据：`isPending || turnRuns[activeSessionId] != null`。attach 不是 mutation，不占 `isPending`；统一判据保证撞忙 attach 期间不能再次发送（此时发送必 409）。

### D8: 409 静默转 attach

发送路径 catch `ApiRequestError`：`code === 'SESSION_BUSY' && runId` → 记入 `turnRuns` → 启动 attach。乐观消息由现有 `onError` 回滚（消息确实未被接受），回滚与 attach 并行不冲突。不做提示弹窗——无缝接入是既定 UX 方向（探索期决策）。

### D9: 会话列表 generating 徽标 + 未打开会话的取消入口

`SessionItem` 按 entry 的 `generating` 渲染脉冲徽标；`generating` 时 hover 显示停止按钮，点击 `cancelTurn(sessionId, entry.run_id)`（无需 attach，徽标随重取消失）。`useSessions` 的查询单独设 `refetchOnWindowFocus: true`——全局关闭是为保护 Monaco 未保存编辑，sessions 列表不碰文件内容，不在保护范围内；这同时是 detach 后感知 turn 结束的主通道。

### D10: NUL 分隔符统一为空格

`use-send-message.ts` 的 `bufferKey`/`splitBufferKey` 源码内嵌裸 NUL 字节（git 视为二进制、grep 不可见，且与自身注释"按首个空格拆回"及 `message-list.tsx` 的 `blockKey` 不一致）。统一为空格，依赖已在三处注释文档化的不变量"agent 名不含空格"。

## Risks / Trade-offs

- [取消是异步三态，他副本路径 ≤5s 心跳周期才生效] → UI 即刻进入"取消中"（停止按钮置 disabled），终局事件到达前输入保持禁用；幂等取消允许用户重复点击无副作用
- [attach 依赖 sessions 缓存的 `generating`/`run_id`，可能滞后] → 409 兜底路径保证发送撞忙仍能接入；410/404 回落历史覆盖"flag 撞上已结束 turn"的窗口
- [focus refetch 间隔内徽标不更新] → 接受（产品语义：状态延迟 ≤ 一次窗口切换）；打开会话时的失效重取是第二通道
- [流异常自动重连可能与"turn 恰好刚结束"竞争] → 410/404 一律回落历史，不区分原因；重连有限次后同样回落
- [Redis 降级放行下 409 不绝对] → 前端不据此做防御性设计，最多出现两个流并发写分段——分段模型本就 append-only，错乱可容忍且 Redis 故障是罕见态

## Migration Plan

纯前端变更，随前端发布即生效。后端已上线，发布前旧前端的"停止"按钮处于行为回归窗口（只 detach 不取消）——本变更是对该回归的修复，宜尽快发布。回滚 = 回退前端版本，无数据不兼容。

## Open Questions

- 流异常自动重连的次数/退避参数（暂定 3 次指数退避）——实现期可调，无契约影响。
