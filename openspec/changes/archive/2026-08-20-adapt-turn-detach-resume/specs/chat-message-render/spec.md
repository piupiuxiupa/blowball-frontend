# chat-message-render Delta — adapt-turn-detach-resume

## MODIFIED Requirements

### Requirement: 按 agent 差异化渲染助手消息
系统 SHALL 按消息所属 agent 名采用不同渲染形态：Confucius（主编排 agent）的输出以全宽裸 Markdown 渲染，不套用消息气泡、头像与名字标签；子 agent（Chongzhi、Liang）的输出按调用身份（(agent, run_id) 复合键）各自渲染为独立气泡并默认折叠——并发同名子 agent 调用的交错行按各自 run id 归组，不拼入同一气泡。该规则对持久化消息与流式段统一生效。

#### Scenario: Confucius 输出裸 Markdown
- **WHEN** 渲染 agent 为 Confucius 的助手消息（持久化或流式）
- **THEN** 其正文以全宽 Markdown 直接渲染，不渲染气泡背景、头像与名字标签

#### Scenario: Confucius 的 tool_call 仍以气泡显示
- **WHEN** Confucius 的消息携带 tool_call
- **THEN** 这些 tool_call 以内联气泡形式显示在其裸 Markdown 输出中

#### Scenario: 子 agent 每次调用各自独立气泡
- **WHEN** 渲染 agent 为 Chongzhi 或 Liang 的助手消息
- **THEN** 每次 (agent, run_id) 调用各自渲染为一个独立气泡，不与 Confucius 或其他 agent 合并

#### Scenario: 并发同名调用的交错行按身份归组
- **WHEN** 历史消息中同名子 agent 两次调用（不同 run id）的行交错到达
- **THEN** 两次调用的行分别归入各自调用的气泡，同一气泡内不混入另一次调用的输出

#### Scenario: 子 agent 气泡默认折叠
- **WHEN** 子 agent 气泡首次渲染（含流式中正在输出的活动段）
- **THEN** 其正文默认处于折叠态，折叠态仅显示「名字 + 状态」指示
