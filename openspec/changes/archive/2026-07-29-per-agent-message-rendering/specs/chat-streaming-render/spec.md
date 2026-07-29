## ADDED Requirements

### Requirement: 流式按 agent 分段渲染
系统 SHALL 将同一会话的流式状态按 agent 分段维护：每个 `agent_start` 事件开启一个新段，`token`/`reasoning`/`tool_call` 事件追加到对应 agent 的活动段，使流式过程中不同 agent 的输出即被分隔为各自独立的渲染项，而非等到回合结束后才切分。批量节流与收尾缓冲刷新规则在此分段模型上继续生效。

#### Scenario: 流式中按 agent 分隔展示
- **WHEN** 一个回合内先后出现 Confucius 与 Chongzhi 的 `agent_start`/`token` 事件
- **THEN** 流式渲染区为每个 agent 各自呈现一个独立项，二者内容不合并到同一渲染项

#### Scenario: token 追加到正确段
- **WHEN** 到达带 `agent` 字段的 `token` 事件
- **THEN** 该 token 追加到该 agent 对应活动段的内容中，不串入其他 agent 的段

#### Scenario: 段的稳定标识
- **WHEN** 流式段随 agent 切换而新增
- **THEN** 每个流式段拥有稳定的 React key（段仅追加、不重排），使已渲染段不因新段到达而错位或重挂载

#### Scenario: 缺少 agent_start 时惰性建段
- **WHEN** `token` 事件先于任何 `agent_start` 到达
- **THEN** 系统以该事件的 `agent` 惰性创建一个段并追加内容，不丢失 token

#### Scenario: 回合结束清理分段
- **WHEN** 回合结束、持久化历史确认落库后
- **THEN** 系统清空该会话的流式分段状态，由持久化消息块接管渲染

#### Scenario: 流式进行中判据
- **WHEN** 任一活动段状态为 `running` 或 `tool_call`
- **THEN** 会话被判定为流式进行中；当全部段为 `idle`/`error` 时判定为非流式

## MODIFIED Requirements

### Requirement: 流式收尾立即刷新缓冲
系统 SHALL 在流式结束或单 agent 出错时，立即同步刷新尚未提交的 token 缓冲，确保尾部内容不丢失、不延迟；用户主动中止时则丢弃未提交缓冲并清空流式分段（中止即取消本轮，不保留半截输出、不产生幻影段）。

#### Scenario: 正常结束时刷新尾部
- **WHEN** 收到 `done` 事件且缓冲中仍有未提交 token
- **THEN** 系统在处理该事件前同步提交剩余 token

#### Scenario: 单 agent 出错时刷新尾部
- **WHEN** 收到 `agent_error` 事件且缓冲中仍有未提交 token
- **THEN** 系统同步提交剩余 token 后再将对应段置为错误状态，不产生内容截断

#### Scenario: 用户中止时丢弃缓冲
- **WHEN** 用户主动 abort 本轮流式
- **THEN** 系统丢弃尚未提交的 token 缓冲并清空该会话的流式分段，不再渲染半截输出（与乐观用户消息一并回滚，中止即取消）
