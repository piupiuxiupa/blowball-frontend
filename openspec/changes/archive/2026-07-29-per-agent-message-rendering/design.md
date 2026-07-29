## Context

当前流式链路把同一会话所有 agent 的输出压平为三个 per-session 标量：

- `streamingTokens[sid]` / `streamingReasoningTokens[sid]`：单一拼接字符串（`ui-store.ts`）。
- `agentStatus[sid]`：`{ agent, status }`，每个事件覆盖，只剩「最新 agent」。

`use-send-message.ts` 按 SSE 事件类型改写这三个标量；`message-list.tsx` 读取它们喂给**唯一一个**尾部 `TokenStream`。于是流式期间所有 agent 的文字串在一起、header 只显示最新 agent 名。回合结束后 `reconcileHistory` 重拉持久化历史，`groupMessages`（`message-list.tsx:27`）按 `agent_start`/`agent_end` 切分为多个 block——分隔只在此时才出现。

后端 SSE 已按 agent 打标：每个事件携带 `agent` 字段，并有 `agent_start`/`agent_end` 边界（见 `openapi.yaml` `SSE*` schema）。agent 为固定枚举 `[user, Confucius, Chongzhi, Liang]`；`invoke_chongzhi`/`invoke_liang` 工具表明 Confucius 是主编排 agent，Chongzhi/Liang 是它调用的子 agent。**所需数据已齐备，无需后端改动。**

既有性能机制必须保留：rAF 批量节流（`use-send-message.ts` 的 `tokenBuffer`/`scheduleFlush`）、已完成段落增量 Markdown 渲染（`token-stream.tsx` 的 `splitStreamingContent`/`StreamSegment` memo）、块对象复用缓存（`groupMessagesWithCache`）、长会话虚拟滚动（`useVirtualizer`）。

## Goals / Non-Goals

**Goals:**

- 流式过程中即按 agent 分隔展示，不等回合结束。
- 按 agent 名差异化渲染：Confucius 全宽裸 Markdown；子 agent 各自独立气泡、默认折叠。
- 持久化 block 与流式段归约为同一形状，统一按 agent 派发渲染，消除「流式一套、持久化一套」的割裂。
- 完整保留既有流式性能机制（节流、增量渲染、memo、虚拟滚动）。

**Non-Goals:**

- 不改动后端 / SSE 协议。
- 不改动用户消息渲染（右气泡）与整回合在结束时落库的持久化模型；reconcile 循环保持不变。
- 不在数据层合并/重排同名 agent 段（仅在渲染层处理相邻裸块的视觉间距）。
- 不跨会话持久化展开/折叠状态（纯本地 UI 状态）。

## Decisions

### D1：流式状态 = 每会话一个「按 agent 分段」数组

用 `streamingSegments: Record<sessionId, StreamingSegment[]>` 替换三个标量 map。每段：

```ts
interface StreamingSegment {
  id: string;          // 创建时分配的单调 id，用作稳定 React key（段仅追加、不重排）
  agent: string;
  content: string;
  reasoning: string;
  toolCalls: string[];
  status: 'idle' | 'running' | 'tool_call' | 'error';
  isError?: boolean;
}
```

事件映射：

- `agent_start{A}` → push 新段 `{ id, agent:A, status:'running' }`；活动段 = 数组末尾。
- `token{A}` / `reasoning{A}` → 追加到 agent 为 A 的活动段（见 D2 的缓冲路由）。
- `tool_call{A}` → 记入活动段 `toolCalls`，状态置 `tool_call`。
- `agent_end{A}` → 活动段状态置 `idle`。
- `agent_error{A}` → 先 flush，再置活动段 `status:'error'` / `isError`。
- `done` → flush（清空分段交给 reconcile，沿用现有「确认落库再清」逻辑）。
- `token` 先于任何 `agent_start` 到达 → 以该事件 `agent` 惰性建段（对齐 `groupMessages` 的兜底分支）。

**为何数组而非按 agent 的 map**：数组保留回合内 agent 的先后顺序，与持久化 `groupMessages` 输出（每个 `agent_start` 一个 block）一一对应，渲染顺序自然正确。**为何不用「单字符串 + 哨兵分隔符」**：会破坏段落偏移 key、reasoning/tool_call 的归属路由。

### D2：rAF 批量 flush 按 agent 路由

保留「每帧至多一次 flush」的节流。但因段是按 agent 分的，flush 必须把缓冲追加到正确的段。每个 token 事件都带 `agent`，故采用 **agent-keyed 缓冲**：

```ts
let tokenBuffers: Record<string, string> = {};   // agent -> 待 flush 的 token 串
let reasoningBuffers: Record<string, string> = {};
```

flush 时遍历缓冲，把每个 agent 的串追加到其活动段。这样即便后端未来并行/交错输出多 agent，也不会串段；串行回合下退化为单条目，零额外成本。

**替代方案**：仅维护「当前活动 agent」单缓冲（假设严格串行）——更简但脆弱，遇到交错即错。选择 agent-keyed 以稳健为先。

### D3：渲染按 agent 名派发

持久化 block 与流式段归约为同一个 `AgentBlock` 形状（`agent`/`role`/`content`/`reasoning`/`toolCalls`/`status`/`isError`/`isLive`）。单一派发：

```
role === 'user'              → UserBubble（不变，右侧气泡）
agent === 'Confucius'        → BareConfucius
else (Chongzhi | Liang)      → CollapsibleSubAgent
```

主/子判定键于固定枚举里的字面 agent 名。SSE 无 depth/parent 字段；枚举 + invoke 拓扑使 Confucius 为唯一编排者。若拓扑日后变化，仅需改这一处谓词。

### D4：Confucius = 裸 Markdown

`BareConfucius`：全宽、无 glass 背景、无圆角气泡、无头像、无名字标签；正文按 Markdown 渲染（活动段走共享的增量渲染子件 D6）。其 `tool_call` 仍以内联 `ToolCallBubble` 显示（按用户决定：Confucius 的**所有** tool_call 都显示，含 `invoke_*`）。

被子 agent 打断产生的前后两段 Confucius：按 D1 渲染为各自独立的裸块，**仅在样式层收紧相邻裸块间距**使其读作一篇连贯文本；数据层不合并（与持久化 `groupMessages` 语义一致，避免「流式合并、结束又拆」的二次跳变）。

### D5：子 agent = 可折叠气泡，默认折叠（含活动段）

`CollapsibleSubAgent`：glass 气泡，含「名字 + 状态指示」头部与可折叠正文。

- 默认折叠——同时适用于持久化块初次加载与流式段，**包括正在输出的活动段**（用户明确选择）。
- 折叠态不渲染正文（内容仍在 state 中持续累积）；展开态显示 reasoning + Markdown + tool_call，且展开后尾部继续流式追加。
- 状态指示：`running` → spinner/「回答中」；`tool_call` → 工具图标；`idle` → 完成；`error` → 错误图标。
- 展开/折叠为本地 `useState`，不持久化。
- **性能副作用收益**：折叠的活动段跳过 Markdown 增量渲染，避免重解析成本，直到用户展开。

### D6：共享增量 Markdown 子件

将 `token-stream.tsx` 现有的 `splitStreamingContent` + `StreamSegment` memo 抽成共享的 `<StreamingContent text isLive />`：`BareConfucius`（活动段）与 `CollapsibleSubAgent`（仅展开时）共用；已完成段 / 持久化块走普通 `<MarkdownRenderer>`（全量解析、按内容 memo）。

### D7：message-list 尾部 = N 个流式 item

`ListItem` 的 streaming 变体携带 segment；尾部由「单个 streaming item」改为「按 `streamingSegments` 映射出 N 个 item，各自按 agent 派发」。`isStreaming = streamingSegments 非空且任一段 status ∈ {running, tool_call}`。本轮已结束段（`idle`）在 reconcile 清空前仍留在尾部，按其折叠/展开形态渲染。虚拟列表由「1 个动态高流行」变为「N 个」（通常 1–3），既有「多帧贴底 + `measureElement` 动态高度」机制已能处理。

## Risks / Trade-offs

- **[N 个动态高流式行 vs 1 个]** 每帧重测量增多 → 仅活动段在增长，已结束段高度稳定，折叠子 agent 高度固定；通常 1–3 行，可接受。
- **[Confucius 裸块 + 相邻块]** 间距可能读作一整段或出现缝隙 → 渲染层收紧相邻裸块上边距，需目视验证。
- **[折叠活动子 agent 隐藏实时进度]** 用户看不到正在进行的工作 → 头部状态指示 + 手动展开；属用户明确选择的取舍。
- **[流式 item 的 React key 稳定性]** 段追加时不能错位/重挂载 → 段创建即分配单调 `id`，仅追加、不重排，key 稳定。
- **[token 先于 agent_start]** 边界情形 → 对齐 `groupMessages` 兜底，按事件 `agent` 惰性建段。
- **[后端将来并行/交错输出多 agent]** 简单「末段」路由会错 → D2 的 agent-keyed 缓冲已覆盖。

## Migration Plan

纯前端变更，无数据迁移，单次前端发布即可。回滚即回退前端：持久化 `groupMessages` 行为未变，历史会话渲染完全一致，无持久化状态需要回退。

## Open Questions

- Confucius 的 `invoke_chongzhi`/`invoke_liang` tool_call 是否应隐藏，以避免与紧随的子 agent 气泡重复？当前决定：**全部显示**。若实践中「调用气泡 + 子 agent 气泡」两层显得冗余，再 revisit。（待用户确认。）
