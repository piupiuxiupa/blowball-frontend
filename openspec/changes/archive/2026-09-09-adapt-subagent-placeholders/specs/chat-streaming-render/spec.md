# chat-streaming-render Delta — adapt-subagent-placeholders

## MODIFIED Requirements

### Requirement: 流式按 agent 分段渲染
系统 SHALL 将同一会话的流式状态按 (agent, run_id) 复合键分段维护：每个 `agent_start` 事件开启一个新段，`token`/`reasoning`/`tool_call` 事件追加到对应复合键的活动段，使流式过程中不同 agent 的输出即被分隔为各自独立的渲染项，且并发同名子 agent 调用（同 agent 名、不同 run id）各自成段、互不串文。run id 取自事件的 `meta.parent_tool_call_id`（子 agent 调用的父 invoke tool_call id），缺失（顶层回合事件）按空串处理、退化为按 agent 名分段。批量节流与收尾缓冲刷新规则在此分段模型上继续生效。

活跃 turn 期间，消息列表 SHALL 按 `trace_id` 隐藏该 turn 已经由后端流式落库的助手事件行，仅以当前 `streamingSegments` 中的事件序列渲染该 turn；用户消息 SHALL 保持可见。终局确认历史完整落库并清空流式分段后，再渲染持久化历史，避免“半截历史 + 重放/继续流式”造成重复内容。

子 Agent 的 run 历史懒加载（chat-message-render 的 placeholder 明细区）SHALL NOT 挂载在流式段上：段本身就是该次执行的实时输出，且进行中的 run 尚无终态行可查；懒加载只在持久化块（历史视图）展开时发生。turn 终局 reconcile 清空流式分段后，系统 SHALL 失效该会话的 run 列表缓存，使本 turn 子 Agent 刚落库的终态 run 在气泡展开时立即可见。

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

#### Scenario: 流式段不挂 run 历史懒加载
- **WHEN** 子 Agent 流式段正在输出或本轮已结束但尚未 reconcile 清空
- **THEN** 段内不发起 runs/transcript 请求；明细在持久化历史接管后由气泡展开触发

#### Scenario: turn 终局后 run 立即可展开
- **WHEN** 一个含子 Agent 调用的 turn 完成 reconcile（历史确认落库、分段清空）
- **THEN** 该会话的 run 列表缓存被失效，用户随即展开对应气泡即可看到刚结束的那次执行
