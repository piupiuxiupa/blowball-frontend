# chat-streaming-render Delta — adapt-turn-detach-resume

## MODIFIED Requirements

### Requirement: 流式收尾立即刷新缓冲
系统 SHALL 在流式结束或单 agent 出错时，立即同步刷新尚未提交的 token 缓冲，确保尾部内容不丢失、不延迟。用户主动中止 SHALL 拆分为两种语义：**显式取消**（调用取消端点，见 chat-turn-lifecycle）后继续消费至终局事件并走「重拉确认落库再清分段」收尾，部分输出保留；**本地断开（detach）** 仅停止本端订阅，不清空流式分段（turn 在服务端继续，经 attach 恢复）。

#### Scenario: 正常结束时刷新尾部
- **WHEN** 收到 `done` 事件且缓冲中仍有未提交 token
- **THEN** 系统在处理该事件前同步提交剩余 token

#### Scenario: 单 agent 出错时刷新尾部
- **WHEN** 收到 `agent_error` 事件且缓冲中仍有未提交 token
- **THEN** 系统同步提交剩余 token 后再将对应段置为错误状态，不产生内容截断

#### Scenario: 显式取消后部分输出保留
- **WHEN** 用户点击停止、取消端点接受后流下发终局事件
- **THEN** 系统同步刷新缓冲并走历史重拉收尾，已生成的部分输出与乐观用户消息保留展示

#### Scenario: 本地断开不清空分段
- **WHEN** 流式进行中本地断开 SSE 连接（切换路由、关闭页面）
- **THEN** 系统不清空该会话的流式分段，turn 经服务端继续运行、重开时由 attach 恢复

### Requirement: 流式按 agent 分段渲染
系统 SHALL 将同一会话的流式状态按 (agent, run_id) 复合键分段维护：每个 `agent_start` 事件开启一个新段，`token`/`reasoning`/`tool_call` 事件追加到对应复合键的活动段，使流式过程中不同 agent 的输出即被分隔为各自独立的渲染项，且并发同名子 agent 调用（同 agent 名、不同 run id）各自成段、互不串文。run id 取自事件的 `meta.parent_tool_call_id`（子 agent 调用的父 invoke tool_call id），缺失（顶层回合事件）按空串处理、退化为按 agent 名分段。批量节流与收尾缓冲刷新规则在此分段模型上继续生效。

#### Scenario: 流式中按 agent 分隔展示
- **WHEN** 一个回合内先后出现 Confucius 与 Chongzhi 的 `agent_start`/`token` 事件
- **THEN** 流式渲染区为每个 agent 各自呈现一个独立项，二者内容不合并到同一渲染项

#### Scenario: token 追加到正确段
- **WHEN** 到达带 `agent` 字段的 `token` 事件
- **THEN** 该 token 追加到该 (agent, run_id) 对应活动段的内容中，不串入其他复合键的段

#### Scenario: 并发同名子 agent 调用各自成段
- **WHEN** 同名子 agent 的两次调用（不同 `meta.parent_tool_call_id`）交错输出 token
- **THEN** 两次调用的内容分别落入各自的段，互不混合

#### Scenario: 段的稳定标识
- **WHEN** 流式段随 agent 切换而新增
- **THEN** 每个流式段拥有稳定的 React key（段仅追加、不重排），使已渲染段不因新段到达而错位或重挂载

#### Scenario: 缺少 agent_start 时惰性建段
- **WHEN** `token` 事件先于任何 `agent_start` 到达
- **THEN** 系统以该事件的 (agent, run_id) 惰性创建一个段并追加内容，不丢失 token

#### Scenario: 回合结束清理分段
- **WHEN** 回合结束、持久化历史确认落库后
- **THEN** 系统清空该会话的流式分段状态，由持久化消息块接管渲染

#### Scenario: 流式进行中判据
- **WHEN** 任一活动段状态为 `running` 或 `tool_call`
- **THEN** 会话被判定为流式进行中；当全部段为 `idle`/`error` 时判定为非流式
