# add-message-context-mentions — Design

## Context

现状：`SendMessageRequest.content` 是消息的唯一文本通道；发送管道（`use-send-message.ts` → `apiPostStream` → 落库 → `GET /messages` 回读）对 content 完全透明，不做任何结构化处理。用户消息经 `UserBubble` → `MarkdownRenderer`（react-markdown，**未装 rehype-raw**）渲染。

可用数据源全部现成：

- 文件：`useWorkspaceSearch`（300ms 防抖、basename 子串、递归）与 `useWorkspace`（目录列表，树/搜索两模式）——`src/hooks/use-workspace.ts`
- skill：`useSkills` → `{name, ...}`；MCP tool：`useMcpTools` → `{name, description, server, ...}`——`src/hooks/use-catalogue.ts`
- 侧边栏文件树每行已是 HTML5 拖拽源，完整 workspace 路径写入 `dataTransfer`，mime `application/x-blowball-path`（`file-tree.tsx` `PATH_MIME`），目前仅供树内移动消费。

关键现状约束：**点击文件行 = `selectFile()` 打开预览**是侧边栏核心导航手势，不可占用；`handleKeyDown` 中 Enter 直接触送，弹层需在其之前拦截。

## Goals / Non-Goals

**Goals:**

- 用户能以三种入口附加 文件/目录（拖拽、行内 hover「+」、`@` 弹层），以两个入口附加 skill / tool（`/` 弹层、常驻按钮）。
- chips 条承载已附加项；前端任何界面不出现原始 XML。
- 发送时序列化为 `<additional_context>` 前缀块；历史消息渲染时剥离还原为 chips，乐观消息与落库消息渲染一致。
- OpenAPI 契约零改动。

**Non-Goals:**

- 从操作系统拖入真实文件（涉及先 `apiUpload` 再附加）。
- 发送后编辑/增删 chips（历史 chips 只读）。
- 后端侧对该块的解析、标题生成去污染等（后端适配，另行推进）。
- 修改现有「点击文件行 = 预览」「树内拖拽 = 移动」语义。

## Decisions

### D1. chips 条（方案 B），不做 textarea 内联 token

`Textarea` 是纯 `<textarea>`，无法在文本流内渲染 chip；内联 token 方案要么忍受 `@path` 裸文本（违背「不显示原始格式」），要么引入 contentEditable/overlay 重写输入组件。chips 条下选中即从文本摘除触发串、textarea 只剩正文，序列化逻辑退化为「chips → 前缀块」的纯函数。代价：丢失 token 的上下文位置语义——但序列化格式本身（无位置的 attachments 列表）已经放弃了位置语义，故无损失。

### D2. 一个 ContextPicker 组件、三种唤起

`@` 触发、`/` 触发、两个常驻按钮打开同一组件，以初始分组参数化（`files` / `skills+tools`）。caret 触发检测（mention-widget 式：光标处向前扫描触发符 + 查询串）只实现一遍。弹层内列表渲染复用 catalogue 现有行样式（`chat-panel.tsx` 的 CatalogueButton 下拉已给出 tools/skills 的行形态）。

### D3. 序列化格式（前后端对齐凭据）

块置于 content **最前**，与正文以一个空行分隔；三类 section 按固定顺序输出，**空类别整段省略，三类全空则整块不出现**；属性顺序不敏感（序列化按下列固定顺序输出，解析不依赖顺序）；路径一律补 `./` 前缀：

```
<additional_context>
    <attachments>
        <path type="file">./test/aaa.pdf</path>
        <path type="dir">./test2</path>
    </attachments>
    <skills>
        <skill name="fund-promo-sentiment-v2" />
    </skills>
    <mcps>
        <mcp tool_name="search_banklaw_laws" server="saturn-banklaw" />
    </mcps>
</additional_context>

正文……
```

- 属性值做 XML 转义：`&` → `&amp;`、`<` → `&lt;`、`"` → `&quot;`（文件名含 `&`/引号是现实输入）；解析侧反转义。
- 序列化时去重（同一路径/skill/(tool,server) 只出现一次）；文件与其父目录同时附加不去重，语义冲突交给后端。

### D4. 解析剥离容错：只认「开头 + 结构完整」的块

`parseAdditionalContext(content)` 仅当块位于 content 开头（允许前导空白）且 XML 结构完整合法时，才剥离并返回 `{ chips, rest }`；否则原样返回 null，走现状 Markdown 渲染。理由：

- 用户手打的同形 XML 出现在中间位置或结构残缺时，是**正文的一部分**，宁可不渲染不能误吞。
- 不能依赖 react-markdown 吞 HTML 块的副作用——那会无提示丢弃内容且无法还原 chips，显式解析是唯一正路。
- 旧消息（本变更之前落库）不含该块，天然落进「无块」分支，向后兼容零处理。

### D5. drop 目标只认 `PATH_MIME`

输入框（chips 条 + textarea 外层容器）作为 drop 目标，`dragover` 判定 `e.dataTransfer.types.includes('application/x-blowball-path')` 才 `preventDefault` 并显示 ring 高亮（复用树内 `ring-primary/40` 视觉）；drop 读取 `PATH_MIME` 得到 workspace 相对路径。**不加 `text/plain` 兜底**：树内拖拽同时携带 `text/plain`，兜底会把树外任意文本拖入误判为路径。OS 文件拖入不拦截（Non-Goal，浏览器默认行为）。

### D6. 文件树 hover「+」按钮

`FileNode` / `SearchRow` 行内新增附加按钮，沿用铅笔/垃圾桶的 `group-hover:opacity-100` 绝对定位模式；现有两按钮占 `right-8`/`right-0.5`，新按钮左移至 `right-14` 一带，`pr-14` 行内边距相应加宽。目录行同样提供（附加目录合法）。点击不改变行本身点击行为（文件行仍 `selectFile`）。

### D7. 触发规则与键盘语义

- `@` / `/` 仅在**行首或空白之后**触发（避免邮箱地址、路径正文误触发）；查询串 = 触发符到光标间的非空白串，继续输入即过滤，出现空白/失焦/Esc 关闭。
- 弹层打开期间：`↑`/`↓` 导航、`Enter` 选中当前项（并阻止冒泡，避免触发 `handleKeyDown` 的发送）、`Esc` 关闭；关闭后键盘行为与现状完全一致。
- `e.nativeEvent.isComposing === true` 时不触发弹层（中文 IME 主场景）；选定符号上屏后的下一次 keyup 后再做 caret 扫描，避免组合期内误判。

### D8. chips 状态归属与去重时机

chips 存放于专用的小 Zustand store（`src/stores/attachment-store.ts`，规范化形态 `{kind, path?, name?, server?}`）。原设计为 MessageInput 组件本地 state，实现期发现不成立：hover「+」按钮（侧边栏文件树）与输入区（chips 条渲染、序列化消费）是互不为父子的两棵子树，本地 state 无法跨树写入；ui-store 又过重且语义混杂。专用 store 保住了 D8 原有的生命周期语义——不持久化、切换会话不清空，发送成功 `clear`、请求级失败 `restore`（时机仍由输入区控制）。**插入时去重**（重复点击/hover 附加无感），序列化只做映射不做过滤。

### D9. `@` 弹层数据源 = 侧边栏同款双模式

查询为空 → 浏览模式：`useWorkspace(root)` 列目录，点目录进入（root 下沉）；输入非空 → 搜索模式：`useWorkspaceSearch` 防抖搜索，行内展示父目录路径（复用 `SearchRow` 形态）。与侧边栏交互模型一致，零新 hook。`truncated` 时提示收窄关键词（沿用侧边栏文案口径）。

### D10. 历史渲染：剥离点在 UserBubble 之前

在 `UserBubble`（或其上游 `AgentMessage` 的 user 分支）调用 `parseAdditionalContext`：有块 → 上方渲染只读 chips 区（文件/目录/技能/工具四类图标区分），余下正文照常走 `MarkdownRenderer`；文件 chip 左键 `setActiveFile` 打开预览（低成本增强）。乐观消息与落库消息同为 content 字符串、同一路径，流式中与 reconcile 后显示自然一致。

## Risks / Trade-offs

- [后端解析侧的严格性未知（空 section、`./` 前缀、属性/section 顺序、转义）] → 本 design D3 即对齐凭据，联调前与后端逐条确认；解析器按「宽容解析、严格序列化」实现。
- [会话标题自动生成若后端不做剥离，标题可能含 XML] → 后端适配项，Open Questions 跟踪。
- [IME 组合期内触发误判] → D7 的 isComposing 防护 + 手动验证任务（拼音输入 `@`、`/`、词中 `@`）。
- [用户手打合法 XML 于开头会被渲染成 chips] → 已知且接受：该串与机器生成形态不可区分，规范行为即「开头合法块 = 附加上下文」；文案上不提供豁免语法。
- [Enter 拦截回归] → 弹层键盘处理仅在弹层打开时短路按键，关闭路径零改动；任务中含「弹层关闭时 Enter 发送不回归」验证项。
- [大工作区搜索 `truncated`] → 沿用侧边栏「匹配较多，仅显示前 N 条」提示口径。
- [XML 属性注入] → 序列化侧转义 `& < "`，解析侧反转义；不做超出属性值的防御（内容不含自由文本节点）。

## Open Questions

- 后端标题生成/持久化管道是否需要剥离 `<additional_context>`（属后端仓库工作，联调时确认）。
- MCP tool 多选上限是否需要软限制（当前按无限制实现，观察真实 catalogue 规模再定）。
