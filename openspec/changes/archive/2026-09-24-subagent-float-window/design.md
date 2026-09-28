## Context

当前子 agent 输出由 `CollapsibleSubAgent` 以行内折叠/展开渲染在聊天消息流里：折叠行（名字 + 状态）点击后在气泡内展开 reasoning、`OrderedMessageContent`（正文 + 工具 timeline）与 `SubAgentRunTranscripts`（历史 runs 懒加载）。配套状态有按块持久化展开（`subAgentExpanded`，解决虚拟列表卸载丢展开态）与全局展开/收起（`expandAll` / `collapseVersion` / 输入框旁 `ExpandAllButton`）。

问题：长 transcript 行内展开会撑开并淹没主回答。目标：聊天流只留触发行，点击打开独立浮窗（方案 C：固定定位、单实例、非模态）。

## Goals / Non-Goals

**Goals:**

- 聊天流内子 agent 只占一条常驻触发行；完整内容在浮窗中查看。
- 浮窗单实例（打开另一个顶掉旧的），固定定位、非模态，Esc / 关闭按钮关闭。
- 流式子 agent 在浮窗内实时追加；turn 终局 reconcile 后无缝切到持久化块明细，不关窗不闪空。
- 滚动聊天列表（虚拟列表卸载触发行组件）不影响已打开的浮窗。
- 复用现有内容组件与 runs 懒加载接口，零新依赖。

**Non-Goals:**

- 不做可拖拽 / 可缩放 / 多窗并排。
- 不做锚定气泡跟随触发行定位（虚拟列表滚动下锚点不稳）。
- 不改后端 API、消息分组、SSE 分段模型。

## Decisions

### D1. 非模态固定浮窗，无遮罩、无拖拽

窗体 `fixed` 定位在聊天视口右侧（`z-40`，低于设置弹窗 `z-50`），仅关闭按钮 + Esc 关闭。备选：复用 `LLMTokenDialog` 的模态遮罩（挡聊天交互，违背"边看边流"诉求）；锚定气泡（虚拟列表卸载/滚动导致锚点飘移）；可拖拽多窗（状态与 z-index 管理成本，YAGNI）。

### D2. 窗口挂在 ChatPanel 层，ui-store 存单打开态，按身份解析数据

ui-store 新增 `openSubAgentWindow: { sessionId, target } | null`，`target` 为流式段 id 或持久化块 id。浮窗组件渲染在 `ChatPanel`（虚拟列表之外），按身份从活源解析数据：段 → `streamingSegments` 选择器；持久化块 → `useMessages` 缓存 + 复用 `groupMessages` 分组（memo 化）。不做内容快照——快照会随流式过期，身份解析让实时更新免费获得。切换会话时打开态置 null。

### D3. reconcile 时按 agentInstanceId 重定向

turn 终局清空流式分段时，若浮窗正指向该段，按 `agentInstanceId` 在重新分组后的持久化块中找回对应块并重定向打开态。既有 reconcile 语义（确认完整落库后才清段）保证块必然存在；兜底找不到则关闭浮窗并清态。

### D4. 内容组件全复用，只换容器

浮窗主体 = 现展开体三件套原样搬入：reasoning `<details>`、`OrderedMessageContent`、`SubAgentRunTranscripts`（仅持久化块挂载，懒加载语义不变）。`CollapsibleSubAgent` 重构为纯触发行 `SubAgentRow`（新文件 `sub-agent-row.tsx`），删除折叠/展开逻辑。全局展开链路删除后 `useGlobalDetails` 一并移除，思考/工具卡回归原生局部开合。

### D5. ArtifactLinkContext 在窗口内重建

持久化块的产物链接钉版依赖 `ChatMessage` 外层的 `ArtifactLinkContext.Provider`。打开态随块携带不可变快照 `{artifacts, msgTime}`，浮窗内容包一层同名 Provider，钉版行为与行内一致。流式段现状即无 Provider，维持不变。

### D6. 删除整条展开态链路

删除 `subAgentExpanded` 持久化 map、`setSubAgentBlockExpanded`、`expandAll` / `collapseVersion` / `toggleContentExpandAll` 与 `ExpandAllButton`。行内展开不存在后三者失去语义；浮窗在虚拟列表外，原"滚动存活"问题消失。净删代码。

## Risks / Trade-offs

- [长 transcript 撑爆窗体] → 窗体 `max-h` + 内部滚动，正文区复用现有 `max-h-64 overflow-auto` 约束模式。
- [Esc 误伤输入框] → 窗口 Esc 监听检查 `event.target` 不在 input/textarea/contentEditable 内。
- [reconcile 重定向找不到块] → 兜底关闭浮窗（理论上不发生，见 D3）。
- [用户习惯"展开全部"] → 行为移除而非等价替代；浮窗单实例即新的批量查看上限。需要时再加多窗，现在不做。

## Migration Plan

纯前端行为变更，无数据/接口迁移。合入即生效；回滚 = revert 提交。`subAgentExpanded` 为内存态（非持久化存储），删除无残留。
