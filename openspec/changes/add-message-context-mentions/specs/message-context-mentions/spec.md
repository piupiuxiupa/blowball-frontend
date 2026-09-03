# message-context-mentions — Delta Spec

## ADDED Requirements

### Requirement: 附加上下文序列化格式
发送消息时，系统 SHALL 把已附加的 文件/目录、skill、MCP tool 序列化为 `<additional_context>` XML 块，置于 content 最前并以一个空行与正文分隔。序列化 MUST 满足：三类 section 按固定顺序（attachments → skills → mcps）输出；某类无附加项时该 section 整段省略；三类全空时整个块不出现；文件/目录路径 MUST 以 `./` 前缀输出；属性值 MUST 做 XML 转义（`&`、`<`、`"`）；重复附加项 MUST 去重。OpenAPI 契约不变（content 仍为单字符串）。

#### Scenario: 三类均有时输出完整块
- **WHEN** 用户附加了文件 `test/aaa.pdf`、目录 `test2`、skill `fund-promo-sentiment-v2` 与 MCP tool `search_banklaw_laws`（server `saturn-banklaw`），正文为「分析一下」并发送
- **THEN** 发送的 content 为 `<additional_context>` 块（含 attachments/skills/mcps 三个 section、路径带 `./` 前缀、mcp 携带 `server` 属性）后接空行与「分析一下」

#### Scenario: 部分类别为空时省略对应 section
- **WHEN** 用户仅附加了一个文件，未附加目录、skill 与 tool
- **THEN** 块内仅含 `attachments` section，`skills` 与 `mcps` section 不出现

#### Scenario: 无任何附加时不产生块
- **WHEN** 用户未附加任何项并发送纯文本消息
- **THEN** content 与现状完全一致，不含 `<additional_context>` 块

#### Scenario: 特殊字符转义
- **WHEN** 附加的文件名含 `&`、`<` 或 `"` 字符
- **THEN** 序列化输出中这些字符以 `&amp;`、`&lt;`、`&quot;` 形式出现，不破坏 XML 结构

### Requirement: 文件与目录的附加入口
系统 SHALL 提供三种文件/目录附加方式，且 MUST NOT 改变「点击文件行 = 打开预览」与「树内拖拽 = 移动」的既有语义：
1. 侧边栏文件树行（含搜索结果行）hover 显示「+ 附加」按钮，点击即附加；
2. 从侧边栏拖拽文件/目录至输入区 drop 即附加；
3. 在输入框键入 `@` 弹出工作区选择列表（空查询浏览目录、输入即防抖搜索），点击列表项即附加。

#### Scenario: 拖拽附加
- **WHEN** 用户把侧边栏中的文件（或目录）拖到输入区释放
- **THEN** 该条目以文件（或目录）形态加入 chips 条，输入区出现 drop 高亮反馈，文件树内不发生移动

#### Scenario: hover 按钮附加
- **WHEN** 用户 hover 侧边栏某个文件行并点击「+ 附加」按钮
- **THEN** 该文件加入 chips 条，中心面板不打开该文件（行点击预览行为不受影响）

#### Scenario: @ 弹层选择附加
- **WHEN** 用户在输入框键入 `@` 及关键词并点击结果中的某个条目
- **THEN** 该条目加入 chips 条，`@` 触发串与查询文本从 textarea 中移除

#### Scenario: 点击文件行仍为预览
- **WHEN** 用户照常点击侧边栏文件行（未点击附加按钮、未拖拽）
- **THEN** 行为与现状一致：文件在中心面板打开，不产生附加

### Requirement: skill 与 MCP tool 的附加入口
系统 SHALL 提供两种 skill / MCP tool 附加方式：输入框键入 `/` 弹出分组选择列表（Skills 与 MCP Tools 两组），以及输入区常驻的「技能」「工具」两个按钮打开相同弹层。选择即附加；MCP tool 附加时 MUST 记录其 `server` 归属。

#### Scenario: / 触发分组弹层
- **WHEN** 用户在输入框行首键入 `/`
- **THEN** 弹出含 Skills 与 MCP Tools 两组的选择列表，继续输入可按名称过滤

#### Scenario: 常驻按钮打开弹层
- **WHEN** 用户点击输入区的「工具」按钮
- **THEN** 打开与 `/` 触发一致的 MCP Tools 选择列表，点击某 tool 即附加（含其 `server`）

#### Scenario: tool 与 server 绑定
- **WHEN** 用户附加了一个 MCP tool
- **THEN** 序列化时该条目输出 `tool_name` 与 `server` 两个属性

### Requirement: chips 条交互
输入区 SHALL 以 chips 条（类邮件附件）承载已附加项，每类以可区分的图标标识（文件/目录/技能/工具），每个 chip MUST 可单独移除；textarea MUST 始终只承载正文文本（不出现路径、名称等原始附加信息）。发送失败时已附加的 chips MUST 保留以便重试。

#### Scenario: 选中即成 chip
- **WHEN** 用户通过任一入口附加一个条目
- **THEN** 输入区出现对应 chip，textarea 正文中不新增任何文本

#### Scenario: 重复附加去重
- **WHEN** 用户对同一文件（或同一 skill、同一 tool+server）再次附加
- **THEN** chips 条不出现重复项

#### Scenario: 移除 chip
- **WHEN** 用户点击某个 chip 的移除按钮
- **THEN** 仅该条目从附加列表移除，其余 chips 与正文不受影响

#### Scenario: 发送失败保留
- **WHEN** 消息发送发生请求级失败（网络/4xx），输入文本按现状恢复
- **THEN** 已附加的 chips 同样保留，用户可直接重试

### Requirement: 弹层触发与键盘语义
`@` 与 `/` 触发 MUST 仅在行首或空白字符之后生效；输入法组合（isComposing）期间 MUST NOT 触发。弹层打开期间系统 SHALL 支持 `↑`/`↓` 导航、`Enter` 选中当前项、`Esc` 关闭；`Enter` 选中 MUST NOT 同时触发消息发送。弹层关闭后输入框键盘行为 MUST 与现状完全一致（Enter 发送、Shift+Enter 换行）。

#### Scenario: 词中 @ 不触发
- **WHEN** 用户在「邮箱 a@b」这类非空白后位置键入 `@`
- **THEN** 不弹出选择列表，`@` 作为普通文本输入

#### Scenario: 弹层内 Enter 不发送
- **WHEN** 弹层打开且某列表项高亮时用户按下 Enter
- **THEN** 该项被选中附加，消息不发送、输入框不清空

#### Scenario: Esc 关闭后行为复原
- **WHEN** 用户按 Esc 关闭弹层后再按 Enter
- **THEN** 弹层不再出现，消息按现状逻辑发送

### Requirement: 历史消息渲染剥离
渲染用户消息时，系统 SHALL 解析 content 开头（允许前导空白）的 `<additional_context>` 块：结构完整合法时以只读 chips 呈现附加项（文件/目录 chip 点击可在中心面板打开预览），余下正文照常 Markdown 渲染；块不存在、不位于开头或结构不合法时 MUST 按现状原样渲染，MUST NOT 丢弃或改写任何正文文本。乐观消息与落库历史消息 MUST 走同一解析渲染路径。

#### Scenario: 合法块渲染为 chips
- **WHEN** 历史消息 content 以合法 `<additional_context>` 块开头
- **THEN** 气泡内呈现附加项 chips 与正文 Markdown，原始 XML 不可见

#### Scenario: 非开头或残缺 XML 原样渲染
- **WHEN** 用户消息正文中出现位置不在开头或结构不完整的同形 XML 文本
- **THEN** 该文本按普通 Markdown 原样渲染，不产生 chips、内容不丢失

#### Scenario: 旧消息向后兼容
- **WHEN** 渲染本变更之前落库的用户消息（不含该块）
- **THEN** 渲染行为与现状完全一致

#### Scenario: 乐观消息与落库消息一致
- **WHEN** 用户发送带附加项的消息，从流式展示切换到 reconcile 后的落库历史
- **THEN** 两阶段的 chips 与正文呈现一致，无 XML 闪现
