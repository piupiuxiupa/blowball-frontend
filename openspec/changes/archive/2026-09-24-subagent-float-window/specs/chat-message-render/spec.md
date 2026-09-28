## MODIFIED Requirements

### Requirement: 按 agent 差异化渲染助手消息

系统 SHALL 按消息所属 agent 名采用不同渲染形态：Confucius（主编排 agent）的输出以全宽裸 Markdown 渲染，不套用消息气泡、头像与名字标签；子 agent（Chongzhi、Liang）的输出按调用身份（(agent, run_id) 复合键）各自渲染为独立触发行——并发同名子 agent 调用的交错行按各自 run id 归组，不拼入同一行。触发行仅显示「名字 + 状态」指示，点击打开浮窗单独查看完整内容（见 subagent-float-window），不提供行内展开。每个 agent 范围内的正文片段与工具调用 SHALL 按事件到达顺序在浮窗内容中渲染，不得把工具记录统一汇总到正文之后；tool_result SHALL 按 tool_call_id 合并到对应工具调用卡内，而不是渲染为独立结果卡。该规则对持久化消息与流式段统一生效。

子 agent 触发行在全局消息流中的位置 SHALL 跟随其父 invoke tool_call 的到达顺序：父 agent 在子 agent 开始前输出的内容位于子 agent 触发行之前；子 agent 结束后父 agent 继续输出的内容位于该行之后，不得因为按 agent 归组而把子 agent 触发行整体挪到父 agent 完整消息末尾。

placeholder 视图（见「消息历史消费 placeholder 子 Agent 视图」）下，动态子 agent 实例的正文明细 SHALL 收拢为浮窗打开时懒加载的 run 明细区（见「点击子 Agent 气泡懒加载内容」）；同一实例跨 turn resume 归并为一条线程，明细区只挂载一次——孤立的 `agent_error` 块 SHALL 归并进同实例既有线程块，不产生第二个挂载点。

#### Scenario: Confucius 输出裸 Markdown

- **WHEN** 渲染 agent 为 Confucius 的助手消息（持久化或流式）
- **THEN** 其正文以全宽 Markdown 直接渲染，不渲染气泡背景、头像与名字标签

#### Scenario: 顶层工具记录与正文按顺序内联

- **WHEN** Confucius 依次输出正文 A、tool_call、正文 B 与 tool_result
- **THEN** 渲染顺序为正文 A、携带结果的工具调用卡、正文 B；参数与结果在同一张卡内展开查看，不出现独立的工具结果卡，也不出现把工具记录汇总到全部正文之后的折叠组

#### Scenario: 子 agent 工具记录不逃出自身调用

- **WHEN** 一个子 agent 调用内依次输出正文、tool_call、tool_result 与后续正文，同时顶层或其他子 agent 也有交错事件
- **THEN** 该子 agent 的正文与携带结果的工具调用卡仍全部渲染在其 (agent, run_id) 对应的浮窗内容中，且正文与工具调用节点保持上述顺序

#### Scenario: 子 agent 触发行按父工具调用位置插入

- **WHEN** Confucius 依次输出正文 A、invoke tool_call、子 agent 完整输出、tool_result 与正文 B
- **THEN** 全局渲染顺序为正文 A、携带结果的 invoke 工具卡、子 agent 触发行、正文 B；正文 B 不得被合并回正文 A 所在块从而导致子 agent 触发行显示在正文 B 之后

#### Scenario: 出错工具结果按原位标红

- **WHEN** tool_result 的 status === 1
- **THEN** 对应工具调用卡在原调用位置标红并展示失败结果，不改变该调用卡与其他正文 / 工具节点的相对顺序

#### Scenario: 子 agent 每次调用各自独立触发行

- **WHEN** 渲染 agent 为 Chongzhi 或 Liang 的助手消息
- **THEN** 每次 (agent, run_id) 调用各自渲染为一个独立触发行，不与 Confucius 或其他 agent 合并

#### Scenario: 并发同名调用的交错行按身份归组

- **WHEN** 历史消息中同名子 agent 两次调用（不同 run id）的行交错到达
- **THEN** 两次调用的行分别归入各自调用的触发行，同一行内不混入另一次调用的输出

#### Scenario: 子 agent 触发行常驻收起

- **WHEN** 子 agent 触发行首次渲染（含流式中正在输出的活动段）
- **THEN** 聊天流内仅显示「名字 + 状态」指示，无行内展开态；完整内容仅经浮窗查看

#### Scenario: 触发行不渲染正文但持续累积

- **WHEN** 子 agent 触发行处于聊天流中且仍在其回合内接收流式 token
- **THEN** 其正文不在聊天流内渲染，但内容持续累积；打开浮窗后可见已累积的全部正文并继续追加尾部

#### Scenario: 完整内容在浮窗中显示

- **WHEN** 用户点击一个子 agent 触发行
- **THEN** 浮窗内显示该 agent 的完整思考过程，以及按事件顺序交替排列的 Markdown 正文与工具记录

#### Scenario: 状态指示随生命周期变化

- **WHEN** 子 agent 的状态在 running / tool_call / idle / error 间变化
- **THEN** 触发行与浮窗分别显示对应的状态指示（如 spinner / 工具图标 / 完成 / 错误）

#### Scenario: 跨 turn resume 的实例只挂一个明细区

- **WHEN** 同一动态子 agent 实例在后续用户回合被 resume，历史中再次出现其标记行
- **THEN** 该实例仍归并为同一线程触发行，浮窗中的 run 明细区只挂载一份，覆盖其全部终态 run

### Requirement: 点击子 Agent 气泡懒加载内容

placeholder 视图下的子 Agent 内容 SHALL 在**浮窗打开且目标为持久化块时**请求该实例的 subagent runs 接口获取：仅一条终态 run 时 SHALL 直接展示该次执行的 transcript（任务/思考/工具调用明细），无需再次点击；多条 run（resume 续跑）时 SHALL 按时间倒序列出执行记录，由用户逐条展开。浮窗未打开或目标为流式段时不发起任何 runs 请求。

#### Scenario: 打开浮窗加载子 Agent 内容

- **WHEN** 用户点击一个 placeholder 模式的子 Agent 触发行（持久化块）
- **THEN** 系统请求 `GET .../subagents/{agent_instance_id}/runs` 并在浮窗内展示该实例的执行明细

#### Scenario: 唯一 run 直接展示

- **WHEN** 被打开的子 Agent 实例只有一条终态 run
- **THEN** 浮窗内直接展示该次执行的 transcript，不再要求用户点开「第 N 次执行」

#### Scenario: 多 run 实例逐条展开

- **WHEN** 被打开的子 Agent 实例跨 turn resume 产生多条终态 run
- **THEN** 浮窗内按时间倒序列出各次执行（状态、消息数、完成时间），用户点击某次执行才请求其 transcript

#### Scenario: 未打开不请求

- **WHEN** 子 Agent 触发行仅在聊天流中显示、浮窗未打开（或浮窗正展示流式段）
- **THEN** 系统不为该实例发起任何 runs/transcript 请求
