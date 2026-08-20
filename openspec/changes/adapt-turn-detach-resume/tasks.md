# Tasks: adapt-turn-detach-resume

## 1. 前置收尾：subagent-run-identity 在飞适配

- [x] 1.1 修复 `src/hooks/use-send-message.ts` 复合键分隔符：`bufferKey`/`splitBufferKey` 源码中的裸 NUL 字节统一改为空格，对齐 `message-list.tsx` 的 `blockKey` 与既有注释（消除 git 二进制识别）
- [x] 1.2 `npm run lint` 通过，在浏览器中验证串行回合与（如可构造）并发同名子 agent 调用的流式分段/历史分组不串段（浏览器全流程验证统一收敛至 7.2）
- [x] 1.3 提交在飞改动（`ui-store.ts`、`message-list.tsx`、`use-send-message.ts`、`openapi.yaml`、`openapi.d.ts` 的 subagent 部分），与本变更后续提交分离（54ef023）

## 2. api 层与 SSE 解析

- [x] 2.1 `src/lib/api.ts` 新增 `apiPostAgent<T>`（非流式 POST 走 agent base，cancel 用）与 `apiGetStream`（SSE GET 走 agent base，支持 `Last-Event-ID` 请求头与 `signal`）
- [x] 2.2 `ApiRequestError` 增加可选 `runId`，`apiPostStream` 的错误解析在 409 body 携带 `run_id` 时填充
- [x] 2.3 `api.ts` re-export `TurnStatusResponse` 与含 `generating`/`run_id` 的会话列表项类型（维持 `paths` 不出 `api.ts` 惯例）
- [x] 2.4 `src/lib/sse.ts` 的 `SSEEvent` 增加 `id?: string`，`parseEvent` 解析 `id: ` 行

## 3. 状态与事件消费重构

- [x] 3.1 `ui-store` 新增 `turnRuns: Record<sessionId, { runId: string; lastEventId: string | null }>` 及其读写 action（终局清理含在消费循环收尾）
- [x] 3.2 将 `use-send-message.ts` 内的事件 switch（含 rAF 复合键缓冲、终局 flush）抽为共享消费函数 `consumeTurnStream(sessionId, response, ...)`，消费中每事件更新 `lastEventId`
- [x] 3.3 发送路径接入共享消费函数：流建立时从 `X-Run-Id` 响应头（兜底首个 `agent_start` 的 `meta.run_id`）写入 `turnRuns`
- [x] 3.4 `abort()` 语义收窄为仅 detach（断开 fetch、不清流式分段、不回滚乐观消息），仅供组件清理/会话删除路径使用

## 4. 显式取消

- [x] 4.1 新增 `cancelTurn(sessionId, runId)`（`apiPostAgent` 调 cancel 端点，fire-and-forget，失败 toast 提示）
- [x] 4.2 `MessageInput` 停止按钮改调 `cancelTurn`，取消中停止按钮置 disabled（终局事件到达前输入保持禁用）
- [x] 4.3 验证取消路径走既有 `reconcileHistory`：部分输出与乐观用户消息保留展示、不回滚（对照 spec「显式取消后部分输出保留」）

## 5. attach 接入

- [x] 5.1 新增 `useAttachRun(sessionId)`：会话切换时依 `generating && run_id && !turnRuns[sessionId]` 启动 attach（`apiGetStream` → 共享消费函数），`turnRuns` 占位防重
- [x] 5.2 409 `SESSION_BUSY` catch：记录 body `runId` 并静默转 attach，乐观消息由现有 `onError` 回滚
- [x] 5.3 流异常（非终局断开）以 `lastEventId` 指数退避重连（≤3 次）；重连失败或 410/404 一律回落历史读取并失效 `['sessions']` 与 `['messages', sessionId]`
- [x] 5.4 attach 终局（`done`/流关闭）后走 reconcile 收尾并清理 `turnRuns[sessionId]`
- [x] 5.5 `MessageInput` 禁用判据扩为 `isPending || turnRuns[activeSessionId] != null`

## 6. 会话列表 UI

- [x] 6.1 `SessionItem` 按 `generating` 渲染生成中徽标（脉冲指示）
- [x] 6.2 `generating` 会话项提供取消入口（hover 显示，调 `cancelTurn`，无需打开会话）
- [x] 6.3 `useSessions` 的会话列表查询单独设 `refetchOnWindowFocus: true`

## 7. 端到端验证

- [x] 7.1 `npm run lint` 通过
- [ ] 7.2 浏览器全流程验证：发送→流式→显式取消（部分输出保留）；发送后关闭页面→后端继续→重开自动 attach 续传；运行中会话再次发送→409 静默接入；`generating` 徽标与列表取消入口；detach 后窗口聚焦列表刷新
- [ ] 7.3 分体部署冒烟：仅设 `VITE_AGENT_BASE_URL` 时 cancel/attach 端点可达（验证 agent 分区路由正确）
