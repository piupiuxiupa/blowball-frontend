# add-message-context-mentions

## Why

用户目前只能在消息正文里用自然语言描述想引用的工作区文件或想调用的 skill / MCP 工具，后端无法结构化地感知「这条消息附带哪些文件、希望启用哪个技能/工具」。本变更为聊天输入增加结构化的上下文附加能力：以统一约定（`<additional_context>` XML 前缀）把附件与 skill / tool 选择传给后端，同时前端全程不暴露原始 XML——输入时以 chips 条呈现，历史消息渲染时剥离 XML 还原为 chips。

## What Changes

- **新增消息上下文附加（chips 条形态，类邮件附件）**：输入区新增 chips 条，承载已附加的 文件/目录、skill、MCP tool，每项可单独移除；textarea 始终只承载正文。
- **文件/目录的三个附加入口**（「点击文件行 = 打开预览」手势保持不变）：
  - 侧边栏文件树行（含搜索结果行）hover 出现「+ 附加」按钮，点击即附加；
  - 从侧边栏拖拽文件/目录到输入框 drop 即附加（复用现有 `application/x-blowball-path` 拖拽源）；
  - 输入 `@` 弹出工作区选择列表（搜索 + 浏览），点击列表项即附加。
- **skill / MCP tool 的两个入口**：输入 `/` 弹出分组选择列表（Skills / MCP Tools），同时在输入区新增「技能」「工具」两个常驻按钮打开相同弹层；选择即附加，MCP tool 携带其 `server` 归属。
- **发送序列化**：提交时把 chips 序列化为 `<additional_context>` XML 块，置于 content 开头（正文之前）；路径补 `./` 前缀；空类别整段省略；三项全空则整个块不出现。OpenAPI 契约零改动（`content` 仍为 string）。
- **历史渲染剥离**：用户消息渲染时解析 content 开头的合法 `<additional_context>` 块 → 以 chips 呈现，余下正文照常 Markdown；不合法或非开头位置的 XML 原样渲染，不误吞用户正文。
- **Out of scope**：从操作系统（Finder）拖入真实文件（涉及先上传再附加）、发送后编辑 chips、chips 的后端结构化字段（本期仍走 content 字符串）。

## Capabilities

### New Capabilities

- `message-context-mentions`: 消息上下文附加能力——附加入口（拖拽 / hover「+」/ `@` 弹层 / 常驻按钮 / `/` 触发）、chips 条交互、`<additional_context>` 序列化格式、历史消息渲染剥离。

### Modified Capabilities

（无——现有 spec 的 requirement 均不变：`chat-message-render` 的 memo/高亮/虚拟滚动行为不变，`workspace-file-move` 的拖拽移动语义不变，`chat-turn-lifecycle` 的发送管道不感知本格式。）

## Impact

- **输入区**：`src/components/chat/message-input.tsx`（chips 条、触发检测、常驻按钮、drop 目标）及新增 picker / chips 组件。
- **渲染侧**：`src/components/chat/user-bubble.tsx`（解析剥离 + chips 渲染）；乐观消息与历史消息走同一条渲染路径，天然一致。
- **侧边栏**：`src/components/workspace/file-tree.tsx`（`FileNode` / `SearchRow` 行内 hover「+」按钮，与现有铅笔/删除按钮同模式）。
- **新增 lib**：`<additional_context>` 的序列化与解析（含 XML 属性转义/反转义），供发送与渲染两侧共用。
- **数据源零新增**：复用 `useWorkspaceSearch` / `useWorkspace`（文件）、`useSkills`、`useMcpTools`（`src/hooks/`）。
- **契约影响**：`src/lib/openapi.d.ts` 无需再生成；`SendMessageRequest` 类型不变。XML 格式本身是前后端新约定，格式规格以本变更 specs 为准与后端对齐。
