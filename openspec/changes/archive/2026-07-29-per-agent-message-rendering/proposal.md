## Why

流式过程中，同一会话所有 agent 的 token 被压成单一字符串、用单一「最新 agent」状态渲染成一个合并气泡；只有回合结束、历史重拉后，`groupMessages` 才按 `agent_start`/`agent_end` 切分。结果：流式期间分不清谁在说话，主编排 agent（Confucius）的回答与子 agent（Chongzhi、Liang）的输出混在同一个框里，直到回答全部完成才被分隔开。

同时，现有渲染对所有助手消息套用统一的 glass 气泡，不符合现代 AI 对话工具的阅读形态——主回答应当是全宽裸 markdown、醒目易读，子 agent 的工作应当收进可折叠气泡、默认不打扰。

## What Changes

- 流式状态从「每会话一个标量字符串 + 单个最新 agent 状态」改为「每会话一个按 agent 分段的数组」。每个 `agent_start` 开启一段，token/reasoning 追加到对应段，使**流式期间即按 agent 分隔展示**，不再等回合结束。
- 按 agent 名差异化渲染助手消息：
  - **Confucius**（主编排 agent）的输出以全宽**裸 markdown** 渲染——无气泡背景、无头像、无名字标签，仿 ChatGPT/Claude.ai 的主回答形态；其 `tool_call` 仍以内联气泡显示。
  - **Chongzhi / Liang**（子 agent）的输出各自渲染为**独立气泡，默认折叠**（含流式中正在输出的活动段）；折叠态只显示「名字 + 状态」，展开后显示完整 markdown / 思考过程 / tool_call。
- 持久化消息块与流式段归约为同一形状，按 agent 派发到同一组展示组件，消除「流式一套样式、持久化另一套样式」的割裂。

## Capabilities

### New Capabilities

（无——本变更完全作用于既有能力。）

### Modified Capabilities

- `chat-streaming-render`：流式状态结构由「每会话单字符串 + 单 agent 状态」改为「每会话按 agent 分段的数组」。token 批量节流与流式收尾缓冲刷新规则在分段模型上继续生效，且收尾时按段归属刷新、不丢内容。
- `chat-message-render`：新增「按 agent 差异化渲染」需求——Confucius 裸 markdown、子 agent 默认折叠气泡；既有「所有助手消息一律 glass 气泡」的均匀渲染行为被替换。

## Impact

- `src/stores/ui-store.ts`：`streamingTokens` / `streamingReasoningTokens` / `agentStatus` 三个标量 map 替换为 `streamingSegments`（按 agent 分段的数组）及配套 mutator。
- `src/hooks/use-send-message.ts`：SSE 事件处理改写为分段模型——`agent_start` 推入新段，`token`/`reasoning` 追加到当前活动段，`tool_call` 记入段，`agent_end`/`agent_error` 置段状态；reconcile 与 abort 改为清理分段。
- `src/hooks/use-sessions.ts`：会话清理调用点（`clearStreaming`/`clearStreamingReasoning`）改为清理分段。
- `src/components/chat/message-list.tsx`：虚拟列表尾部由单个 `TokenStream` 改为按段渲染多个 item；`isStreaming` 判据改为「存在非 idle 段」。
- `src/components/chat/`：拆出 `BareConfucius`、`CollapsibleSubAgent` 展示组件，由 `ChatMessage`/`TokenStream` 按 agent 名派发；增量 markdown 渲染逻辑抽成共享子件。
- **无后端改动**：SSE 事件已携带 `agent` 字段与 `agent_start`/`agent_end` 边界标记（见 `openapi.yaml`），所需数据已齐备。
