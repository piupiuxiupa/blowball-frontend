## 1. 流式分段数据模型（ui-store）

- [x] 1.1 在 `src/stores/ui-store.ts` 定义 `StreamingSegment` 类型（`id`/`agent`/`content`/`reasoning`/`toolCalls`/`status`/`isError`）与状态 `streamingSegments: Record<sessionId, StreamingSegment[]>`
- [x] 1.2 实现 mutator：`startAgentSegment(sid, agent)`（push 新段、分配单调 `id`、置 `running`）、`appendSegmentContent(sid, agent, chunk)`、`appendSegmentReasoning(sid, agent, chunk)`、`pushSegmentToolCall(sid, agent, content)`、`setSegmentStatus(sid, agent, status)`、`clearStreamingSegments(sid)`
- [x] 1.3 移除旧的 `streamingTokens` / `streamingReasoningTokens` / `agentStatus` 状态及其 mutator（`appendTokenBatch` / `appendReasoningTokenBatch` / `clearStreaming` / `clearStreamingReasoning` / `setAgentStatus`），同步更新 `UIState` 接口

## 2. SSE 事件处理改写（use-send-message）

- [x] 2.1 将 `tokenBuffer` / `reasoningBuffer` 单字符串改为 **agent-keyed 缓冲**（`Record<agent, string>`）；`flush` 遍历缓冲按 agent 追加到其活动段（design D2）
- [x] 2.2 重写 SSE switch：`agent_start`→`startAgentSegment`；`token`/`reasoning`→缓冲 + `scheduleFlush`；`tool_call`→`pushSegmentToolCall` + 置 `tool_call`；`agent_end`→置 `idle`；`agent_error`→`flush` + 置 `error`；`done`→`flush`
- [x] 2.3 处理「`token` 先于 `agent_start`」的惰性建段兜底（按事件 `agent` 建段）
- [x] 2.4 `reconcileHistory` 与 `abort`、`onError` 改为调用 `clearStreamingSegments` / 段错误处理；保留「确认落库再清」的 reconcile 逻辑

## 3. 展示组件拆分（按 agent 派发）

- [x] 3.1 从 `token-stream.tsx` 抽出共享 `<StreamingContent text isLive />`（迁移 `splitStreamingContent` 与 `StreamSegment` memo）
- [x] 3.2 新建 `BareConfucius`：全宽裸 Markdown（无 glass 背景 / 头像 / 名字标签）；活动段用 `StreamingContent`、已完成用 `MarkdownRenderer`；`tool_call` 以内联 `ToolCallBubble` 显示（含 `invoke_*`）
- [x] 3.3 新建 `CollapsibleSubAgent`：glass 气泡 + 「名字 + 状态指示」头部；`useState` 折叠态默认 `collapsed`（含活动段）；折叠时不渲染正文、展开后显示 reasoning + Markdown + tool_call；状态指示随 running/tool_call/idle/error 变化
- [x] 3.4 新增 `AgentMessage` 派发器（并改造 `ChatMessage`）：按 `role`/`agent` 名分派到 `UserBubble` / `BareConfucius` / `CollapsibleSubAgent`，持久化 block 与流式段共用

## 4. message-list 多段渲染

- [x] 4.1 读取 `streamingSegments[sid]` 替代三个标量；`isStreaming` 改为「任一段 `status` ∈ {running, tool_call}」
- [x] 4.2 `ListItem.streaming` 变体携带 segment；尾部由单 item 改为按 `streamingSegments` 映射的 N 个 item（每段一个，key 用段 `id`）
- [x] 4.3 渲染分支经 `AgentMessage` 按 agent 派发；保留 `groupMessagesWithCache` 块复用与 `useVirtualizer` 虚拟滚动
- [x] 4.4 相邻裸 Confucius 块收紧上边距，使其读作一篇连贯文本（design D4）

## 5. 会话生命周期调用点

- [x] 5.1 `src/hooks/use-sessions.ts` 中 `clearStreaming` / `clearStreamingReasoning` 调用点改为 `clearStreamingSegments`

## 6. 验证

- [x] 6.1 `npm run lint`（`tsc --noEmit`）通过
- [x] 6.2 手动验证多 agent 回合：流式即按 agent 分隔；Confucius 为裸 Markdown；子 agent 默认折叠、展开可见完整内容、状态指示正确
- [x] 6.3 手动验证：折叠中的活动子 agent 展开后继续追加尾部 token；回合结束 reconcile 无内容丢失 / 闪烁
