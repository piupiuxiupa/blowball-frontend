## Why

聊天页在问答内容较多时（长回答、含代码块、长会话历史）频繁卡死/掉帧。根因是流式 token 更新链路存在 O(n) 重渲染风暴：每个 token 都触发整段已渲染内容的 Markdown 重新解析与代码重新高亮，且 token 更新无节流，主线程被完全占满。现在修是因为这直接影响核心交互可用性。

## What Changes

- 流式 token 更新改为 **rAF 批量节流 + 累积缓冲**：token 先进缓冲，每帧最多 flush 一次，把渲染频率压到 ≤60fps。
- 已完成的流式段落改为**增量渲染 + 稳定 key**：每来一个 token 不再重新解析全部已完成段落，仅追加新段落。
- `MarkdownRenderer` **按内容 memo 化**，已完成消息/段落在内容不变时跳过重解析。
- 代码高亮从 `react-syntax-highlighter` 的 Prism **全量包**切换为按需注册语言（`PrismLight` 或等价轻量方案），并按内容缓存高亮结果。
- `groupMessages` 返回的 block 提供**稳定标识与对象复用**，使消息重拉取（`invalidateQueries`）后不触发全部历史消息重渲染。
- 长会话列表引入**虚拟滚动**，仅渲染可视区域内的消息块。

## Capabilities

### New Capabilities
- `chat-streaming-render`: 流式回答的 token 缓冲、节流与增量渲染行为。
- `chat-message-render`: 消息内容的 Markdown/代码高亮渲染优化、消息列表稳定标识与虚拟滚动。

### Modified Capabilities
<!-- 无现存 spec，全部为新增能力。 -->

## Impact

- 受影响代码：
  - `src/lib/sse.ts`、`src/hooks/use-send-message.ts`（token 消费与缓冲）
  - `src/stores/ui-store.ts`（流式状态结构、批量 flush）
  - `src/components/chat/token-stream.tsx`、`src/components/chat/chat-message.tsx`、`src/components/chat/markdown-renderer.tsx`（渲染与 memo）
  - `src/components/chat/message-list.tsx`（分组对象复用、虚拟滚动）
  - `package.json`（可能新增虚拟滚动依赖，如 `@tanstack/react-virtual`；调整 `react-syntax-highlighter` 用法）
- API：无后端契约变更，纯前端渲染层优化。
- 风险：流式展示的视觉行为（如「正在输入」最后一行的纯文本展示）需保持一致；节流不得引入可感知延迟。
