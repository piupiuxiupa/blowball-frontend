# Proposal: adapt-subagent-placeholders

## Why

后端在 `GET /api/v1/sessions/{id}/messages` 新增 `subagent_content=full|placeholder` 视图参数（unique-subagent-message-placeholders 能力，契约已复制进 `openapi.yaml`）：`placeholder` 在分页**之前**过滤——无动态子 Agent 身份的行原样保留；动态子 Agent 行只留生命周期标记（`agent_start`/`agent_end`/`agent_error`，token/reasoning/tool_call/tool_result 负载行全部省略）；父 Agent 重复的 `spawn_subagent` tool_result 行也被省略（父 tool_call 行保留）。

前端在 1.2.0 已接入 per-run transcript 懒加载 API（`SubAgentRunTranscripts`），它正是契约指定的子 Agent 明细来源。继续以默认 `full` 拉历史会把同一份明细渲染两遍（气泡内联一份 + 面板一份），长会话里 payload 行还白白拖慢首屏与 reconcile 计数。切到 `placeholder` 后，子 Agent 气泡正文不再来自消息行，必须改为**点击气泡时才请求 subagent runs 接口**取内容。

## What Changes

- `use-messages` 拉取历史一律带 `subagent_content=placeholder`；`['messages', sessionId]` 缓存只保存 placeholder 视图（发送/attach/reconcile/删除全链路共用同一键空间，不引入新键）。
- 子 Agent 气泡（`CollapsibleSubAgent`）成为占位视图的内容载体：持久化块**展开时**才挂载 `SubAgentRunTranscripts`——内部经 `GET .../subagents/{id}/runs` 取该实例终态执行列表，仅一条 run 时直接展开其 transcript（任务/思考/工具调用明细），多条（resume 续跑）按时间倒序逐条手开。
- 流式段显式不挂懒加载（新增 `runHistory` prop，持久化块 true / 流式段 false）：段本身就是 run 的实时输出，且进行中的 run 无终态行可查。
- `reconcileTurnHistory` 收尾时失效 `['subagent-runs', sessionId]`——本 turn 的 run 此刻才终态落库，否则气泡展开后 5 分钟 staleTime 内看不到刚结束的那次执行。
- 历史分组收尾：孤立的子 Agent `agent_error` 块归并进同实例既有线程块，保证面板唯一挂载点。
- 无新增/修改 API base 路由：两个 subagents runs 端点与 messages 一样走 API base，现状不变。

## Capabilities

### New Capabilities

（无——本变更只修改既有能力的行为，不引入新能力。）

### Modified Capabilities

- `chat-message-render`：子 Agent 历史渲染从「消息行内联全量」改为「占位气泡 + 点击展开时经 runs 接口懒加载明细」。
- `chat-streaming-render`：「流式按 agent 分段渲染」补充流式段不挂 run 历史懒加载的约定（面板只属于持久化块）。

## Impact

- **代码**：`src/hooks/use-messages.ts`、`src/components/chat/message-list.tsx`、`src/components/chat/agent-message.tsx`、`src/components/chat/collapsible-sub-agent.tsx`、`src/components/chat/sub-agent-run-transcripts.tsx`、`src/lib/turn-stream.ts`。
- **契约**：`openapi.yaml`（工作区已更新）+ `src/lib/openapi.d.ts` 重新生成；`src/lib/api.ts` 无需新增 re-export（`SessionMessagesResponse` 形状不变）。
- **兼容**：服务端默认值是 `full`，旧前端/未升级前端不受影响；前端升级后消费的是 placeholder 行集合，所有以 `['messages', sessionId]` 为键的逻辑（乐观消息、reconcile 计数、trace_id 隐藏）语义不变。
