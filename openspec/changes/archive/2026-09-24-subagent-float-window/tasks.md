## 1. 状态与触发行

- [x] 1.1 ui-store：新增 `openSubAgentWindow` 打开态（sessionId + 段/块身份 + artifact 上下文快照）与开/关/重定向 actions；`setActiveSession` 时清空
- [x] 1.2 删除 `subAgentExpanded` / `setSubAgentBlockExpanded` / `expandAll` / `collapseVersion` / `toggleContentExpandAll` 与 `ExpandAllButton`（message-input.tsx）
- [x] 1.3 `CollapsibleSubAgent` → `SubAgentRow`（sub-agent-row.tsx）：只留「名字 + 状态」触发行，点击写入打开态；删旧文件
- [x] 1.4 `AgentMessage` / `ChatMessage` / `MessageList` 适配新触发行与点击回调（流式段与持久化块两条路径）

## 2. 浮窗

- [x] 2.1 新增浮窗容器组件：fixed 右侧、z-40、非模态、关闭按钮 + Esc（输入控件聚焦时不响应）、max-h 内部滚动
- [x] 2.2 内容按身份解析：流式段订阅 `streamingSegments`；持久化块经 `useMessages` + `groupMessages` memo 分组查找
- [x] 2.3 窗体内容复用三件套：reasoning `<details>`、`OrderedMessageContent`、`SubAgentRunTranscripts`（仅持久化块挂载）
- [x] 2.4 ArtifactLinkContext：持久化块在窗内重建 Provider（artifacts + msgTime），产物链接钉版行为与行内一致
- [x] 2.5 挂载到 `ChatPanel`；reconcile 清段时按 agentInstanceId 重定向到持久化块，找不到则关闭

## 3. 验证

- [x] 3.1 `npm run lint`（tsc --noEmit）与 `npm run build`（tsc -b + vite）通过
- [x] 3.2 手工验证：历史块点击开窗、runs 懒加载（单 run 直出/多 run 列表）、流式实时输出、reconcile 无缝接管、滚动聊天不丢窗、Esc/按钮关闭、开另一个替换、切会话关窗
