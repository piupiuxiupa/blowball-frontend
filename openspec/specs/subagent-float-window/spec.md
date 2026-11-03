# subagent-float-window

## Purpose

定义子 Agent 内容浮窗的行为：点击聊天流中的触发行打开单实例、非模态的固定浮窗，完整展示思考过程、正文/工具 timeline 与懒加载的 run 明细；流式实时更新、reconcile 无缝接管、虚拟列表滚动存活、会话切换关闭。

### Requirement: 子 Agent 浮窗打开与单实例替换

系统 SHALL 在点击聊天流中的子 Agent 触发行时打开一个固定定位浮窗，完整展示该子 Agent 的思考过程、按事件顺序排列的正文与工具记录、以及（持久化块）懒加载的 run 明细。浮窗 SHALL 单实例：已打开时点击另一子 Agent 触发行，窗口切换为新目标。浮窗 SHALL 为非模态（不遮挡聊天区交互），并支持关闭按钮与 Esc 关闭。

#### Scenario: 点击触发行打开浮窗

- **WHEN** 用户点击某子 Agent 的触发行
- **THEN** 系统打开浮窗，展示该子 Agent 的思考过程与按事件顺序的正文/工具记录

#### Scenario: 打开另一个子 Agent 替换当前窗口

- **WHEN** 浮窗已展示子 Agent A，用户点击子 Agent B 的触发行
- **THEN** 同一浮窗切换为展示 B 的内容，不出现第二个窗口

#### Scenario: Esc 关闭浮窗

- **WHEN** 浮窗打开且焦点不在文本输入控件内，用户按下 Esc
- **THEN** 浮窗关闭，聊天流与触发行状态不受影响

### Requirement: 浮窗内容实时更新与 reconcile 无缝接管

浮窗 SHALL 按身份（流式段 id / 持久化块 id）订阅数据源：目标为流式段时实时追加输出；turn 终局 reconcile 清空流式分段时，浮窗 SHALL 按实例身份重定向到对应持久化块并继续展示（含 run 明细），不关闭、不闪空。浮窗在聊天面板层渲染，滚动聊天列表使触发行滚出视口（组件卸载）时，浮窗 SHALL 保持打开且内容不丢。

#### Scenario: 流式中浮窗实时输出

- **WHEN** 浮窗展示一个正在流式输出的子 Agent 段，新的 token/reasoning/tool_call 事件持续到达
- **THEN** 浮窗内容实时追加，无需重新打开

#### Scenario: reconcile 后浮窗无缝切换为持久化明细

- **WHEN** 浮窗正展示某子 Agent 的流式段，该 turn 终局、流式分段被清空、持久化历史接管
- **THEN** 浮窗自动改为展示该子 Agent 实例对应持久化块的明细（含懒加载 runs），不关闭、不出现内容空窗

#### Scenario: 滚动聊天不丢浮窗

- **WHEN** 浮窗打开后用户滚动聊天列表，使对应触发行滚出虚拟列表视口
- **THEN** 浮窗保持打开，内容不丢失；滚回后触发行仍可用

### Requirement: 嵌套子 Agent 递归查看

run transcript 内的 `spawn_subagent` 调用若携带后端关联的子实例 id（子实例已存在终态 run 行），系统 SHALL 将其渲染为可下钻的嵌套子 Agent 触发行而非普通工具卡；点击后 SHALL 经同一 sub-agent runs 懒加载接口展示该子实例的执行记录，多级嵌套 SHALL 支持逐层下钻与逐层返回。未携带子实例链接的 spawn 调用（参数错误、预算失败、子实例仍在运行、存量数据）SHALL 保持普通工具卡渲染。

#### Scenario: 点击嵌套触发行下钻

- **WHEN** 用户在某子 Agent 执行详情中点击带子实例链接的 spawn_subagent 触发行
- **THEN** 浮窗内容切换为该嵌套子实例的执行记录（经 runs 接口懒加载），浮窗不关闭

#### Scenario: 多级嵌套逐层返回

- **WHEN** 用户从实例 A 的详情下钻到 B，再从 B 下钻到 C
- **THEN** 每一层级都有返回入口，可逐层回退到上级执行记录

#### Scenario: 无链接的 spawn 调用不下钻

- **WHEN** transcript 内 spawn_subagent 调用未带子实例 id
- **THEN** 该调用仍按普通工具卡渲染，不出现嵌套下钻入口

### Requirement: 浮窗内产物链接钉版

浮窗内子 Agent 正文中的产物链接 SHALL 保持与聊天流内渲染一致的钉版行为：点击后以该块所属 turn 的产物列表与时间钉版到文件区。

#### Scenario: 浮窗内点击产物链接

- **WHEN** 用户点击浮窗正文中指向本 turn 产物的链接
- **THEN** 该产物按与聊天流内相同的钉版规则打开/钉住

### Requirement: 会话切换关闭浮窗

系统 SHALL 在切换活动会话时关闭浮窗并清空打开态。

#### Scenario: 切换会话

- **WHEN** 浮窗打开且用户切换到另一会话
- **THEN** 浮窗关闭，打开态清空
