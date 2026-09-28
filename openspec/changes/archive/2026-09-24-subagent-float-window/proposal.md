## Why

子 agent 的输出目前以行内展开的形式嵌在聊天消息流里：长 transcript（思考过程 + 正文 + 工具记录 + 历史 runs）会把主回答撑开、淹没上下文。需要一个独立于聊天流的查看面——点击子 agent 触发行弹出浮窗，正文留在聊天框外。

## What Changes

- 子 agent 在聊天流中只保留一条常驻触发行（名字 + 状态指示），不再有行内展开态。
- 点击触发行打开**单个固定定位浮窗**：内容 = 思考过程 + 按事件顺序的正文/工具 timeline + 该实例的历史 runs 明细（复用现有内容组件）。
- 浮窗单实例：打开另一个子 agent 顶掉当前窗口；通过关闭按钮 / Esc 关闭。浮窗为非模态——不遮挡聊天区交互，可边滚动聊天边看实时输出。
- 浮窗在聊天面板层渲染（不在虚拟列表内），滚动聊天列表不影响已打开的窗口；流式中的子 agent 在浮窗内实时追加输出。
- **BREAKING（UI 行为）**：删除「展开全部 / 收起全部」入口与按块的持久化展开状态（`subAgentExpanded` / `expandAll` / `collapseVersion` 链路）——行内展开不存在后二者失去语义。

## Capabilities

### New Capabilities
- `subagent-float-window`: 子 agent 内容浮窗的打开/关闭、单实例替换、固定定位、实时流式更新、虚拟列表滚动存活与产物链接上下文保持。

### Modified Capabilities
- `chat-message-render`: 子 agent 气泡从「默认折叠、点击行内展开」改为「常驻触发行、点击打开浮窗」；runs 懒加载时机从气泡展开改为浮窗打开；删除滚动存活/持久化展开相关要求（浮窗天然在虚拟列表外）。
- `chat-streaming-render`: run 历史懒加载的挂载点从「持久化块展开时」改为「浮窗打开且目标为持久化块时」；reconcile 失效 run 缓存的语义不变，仅可见性入口变化。

## Impact

- 代码：`src/components/chat/collapsible-sub-agent.tsx`（触发行重构 + 内容搬入浮窗）、新增浮窗容器组件、`agent-message.tsx` / `chat-message.tsx` / `message-list.tsx`（上下文与 props）、`chat-panel.tsx`（浮窗挂载点）、`src/stores/ui-store.ts`（删展开态链路、增打开态）、`src/components/chat/message-input.tsx`（删 `ExpandAllButton`）。
- API / 依赖：无变化，复用现有 runs/transcript 接口与内容组件。
