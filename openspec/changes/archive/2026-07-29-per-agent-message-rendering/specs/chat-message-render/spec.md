## ADDED Requirements

### Requirement: 按 agent 差异化渲染助手消息
系统 SHALL 按消息所属 agent 名采用不同渲染形态：Confucius（主编排 agent）的输出以全宽裸 Markdown 渲染，不套用消息气泡、头像与名字标签；子 agent（Chongzhi、Liang）的输出各自渲染为独立气泡并默认折叠。该规则对持久化消息与流式段统一生效。

#### Scenario: Confucius 输出裸 Markdown
- **WHEN** 渲染 agent 为 Confucius 的助手消息（持久化或流式）
- **THEN** 其正文以全宽 Markdown 直接渲染，不渲染气泡背景、头像与名字标签

#### Scenario: Confucius 的 tool_call 仍以气泡显示
- **WHEN** Confucius 的消息携带 tool_call
- **THEN** 这些 tool_call 以内联气泡形式显示在其裸 Markdown 输出中

#### Scenario: 子 agent 输出各自独立气泡
- **WHEN** 渲染 agent 为 Chongzhi 或 Liang 的助手消息
- **THEN** 每个 agent 各自渲染为一个独立气泡，不与 Confucius 或其他 agent 合并

#### Scenario: 子 agent 气泡默认折叠
- **WHEN** 子 agent 气泡首次渲染（含流式中正在输出的活动段）
- **THEN** 其正文默认处于折叠态，折叠态仅显示「名字 + 状态」指示

#### Scenario: 折叠态不渲染正文但持续累积
- **WHEN** 子 agent 气泡处于折叠态且仍在其回合内接收流式 token
- **THEN** 其正文不渲染，但内容持续累积；展开后可见已累积的全部正文并继续追加尾部

#### Scenario: 展开显示完整内容
- **WHEN** 用户展开一个子 agent 气泡
- **THEN** 气泡内显示该 agent 的完整 Markdown 正文、思考过程与 tool_call

#### Scenario: 状态指示随生命周期变化
- **WHEN** 子 agent 气泡的状态在 running / tool_call / idle / error 间变化
- **THEN** 折叠态头部与展开态分别显示对应的状态指示（如 spinner / 工具图标 / 完成 / 错误）
