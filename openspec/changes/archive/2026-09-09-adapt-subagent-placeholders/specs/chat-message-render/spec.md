# chat-message-render Delta — adapt-subagent-placeholders

## ADDED Requirements

### Requirement: 消息历史消费 placeholder 子 Agent 视图
系统 SHALL 以 `subagent_content=placeholder` 拉取会话消息历史：动态子 Agent 的明细行（token/reasoning/tool_call/tool_result）与父 Agent 重复的 spawn tool_result 行由服务端在分页前省略；前端把 per-run transcript 懒加载 API（`GET .../subagents/{agent_instance_id}/runs[/{run_id}]`）作为子 Agent 历史明细的唯一规范来源，不依赖消息行内联。`['messages', sessionId]` 查询键空间保持不变，键下缓存的均为 placeholder 视图，发送乐观消息、回滚、reconcile 计数与 attach 回落的既有语义不变。

#### Scenario: 历史拉取携带 placeholder 参数
- **WHEN** 系统分页拉取一个会话的消息历史
- **THEN** 每个分页请求都携带 `subagent_content=placeholder`，响应中子 Agent 行只含生命周期标记

#### Scenario: 子 Agent 明细不重复渲染
- **WHEN** 渲染一段包含动态子 Agent 调用的持久化历史
- **THEN** 子 Agent 的 token/工具明细只出现在气泡展开后的 run 明细区，不再以气泡正文形式从消息行内联渲染

### Requirement: 点击子 Agent 气泡懒加载内容
placeholder 视图下的子 Agent 气泡 SHALL 在**展开时**请求该实例的 subagent runs 接口获取内容：仅一条终态 run 时 SHALL 直接展开该次执行的 transcript（任务/思考/工具调用明细），无需再次点击；多条 run（resume 续跑）时 SHALL 按时间倒序列出执行记录，由用户逐条展开。折叠气泡不发起任何 runs 请求。

#### Scenario: 展开气泡加载子 Agent 内容
- **WHEN** 用户点击展开一个 placeholder 模式的子 Agent 气泡
- **THEN** 系统请求 `GET .../subagents/{agent_instance_id}/runs` 并在气泡内展示该实例的执行明细

#### Scenario: 唯一 run 直接展示
- **WHEN** 被展开的子 Agent 实例只有一条终态 run
- **THEN** 气泡内直接展示该次执行的 transcript，不再要求用户点开「第 N 次执行」

#### Scenario: 多 run 实例逐条展开
- **WHEN** 被展开的子 Agent 实例跨 turn resume 产生多条终态 run
- **THEN** 气泡内按时间倒序列出各次执行（状态、消息数、完成时间），用户点击某次执行才请求其 transcript

#### Scenario: 折叠不请求
- **WHEN** 子 Agent 气泡处于默认折叠态
- **THEN** 系统不为该实例发起任何 runs/transcript 请求

#### Scenario: 滚出视口再滚回展开态不丢
- **WHEN** 用户展开某子 Agent 气泡后向下滚动使其滚出虚拟列表视口（组件卸载），随后滚回
- **THEN** 该气泡仍保持展开，明细内容随组件重挂载恢复（run 列表命中 React Query 缓存，无额外请求）
- **WHEN** 该气泡是流式段（段随 reconcile 整体替换）
- **THEN** 折叠态存续在组件本地，段被替换后按新块默认折叠——持久化块接管后可重新展开

## MODIFIED Requirements

### Requirement: 按 agent 差异化渲染助手消息
系统 SHALL 按消息所属 agent 名采用不同渲染形态：Confucius（主编排 agent）的输出以全宽裸 Markdown 渲染，不套用消息气泡、头像与名字标签；子 agent（Chongzhi、Liang）的输出按调用身份（(agent, run_id) 复合键）各自渲染为独立气泡并默认折叠——并发同名子 agent 调用的交错行按各自 run id 归组，不拼入同一气泡。每个 agent 范围内的正文片段与工具调用 SHALL 按事件到达顺序内联渲染，不得把工具记录统一汇总到正文之后；tool_result SHALL 按 tool_call_id 合并到对应工具调用卡内，而不是渲染为独立结果卡。该规则对持久化消息与流式段统一生效。

子 agent 气泡在全局消息流中的位置 SHALL 跟随其父 invoke tool_call 的到达顺序：父 agent 在子 agent 开始前输出的内容位于子 agent 气泡之前；子 agent 结束后父 agent 继续输出的内容位于该气泡之后，不得因为按 agent 归组而把子 agent 气泡整体挪到父 agent 完整消息末尾。

placeholder 视图（见「消息历史消费 placeholder 子 Agent 视图」）下，动态子 agent 实例的气泡正文明细 SHALL 收拢为展开时懒加载的 run 明细区（见「点击子 Agent 气泡懒加载内容」）；同一实例跨 turn resume 归并为一条线程，明细区只挂载一次——孤立的 `agent_error` 块 SHALL 归并进同实例既有线程块，不产生第二个挂载点。

#### Scenario: Confucius 输出裸 Markdown
- **WHEN** 渲染 agent 为 Confucius 的助手消息（持久化或流式）
- **THEN** 其正文以全宽 Markdown 直接渲染，不渲染气泡背景、头像与名字标签

#### Scenario: 顶层工具记录与正文按顺序内联
- **WHEN** Confucius 依次输出正文 A、tool_call、正文 B 与 tool_result
- **THEN** 渲染顺序为正文 A、携带结果的工具调用卡、正文 B；参数与结果在同一张卡内展开查看，不出现独立的工具结果卡，也不出现把工具记录汇总到全部正文之后的折叠组

#### Scenario: 子 agent 工具记录不逃出自身调用
- **WHEN** 一个子 agent 调用内依次输出正文、tool_call、tool_result 与后续正文，同时顶层或其他子 agent 也有交错事件
- **THEN** 该子 agent 的正文与携带结果的工具调用卡仍全部渲染在其 (agent, run_id) 对应气泡内，且正文与工具调用节点保持上述顺序

#### Scenario: 子 agent 气泡按父工具调用位置插入
- **WHEN** Confucius 依次输出正文 A、invoke tool_call、子 agent 完整输出、tool_result 与正文 B
- **THEN** 全局渲染顺序为正文 A、携带结果的 invoke 工具卡、子 agent 气泡、正文 B；正文 B 不得被合并回正文 A 所在块从而导致子 agent 气泡显示在正文 B 之后

#### Scenario: 出错工具结果按原位标红
- **WHEN** tool_result 的 status === 1
- **THEN** 对应工具调用卡在原调用位置标红并展示失败结果，不改变该调用卡与其他正文 / 工具节点的相对顺序

#### Scenario: 跨 turn resume 的实例只挂一个明细区
- **WHEN** 同一动态子 agent 实例在后续用户回合被 resume，历史中再次出现其标记行
- **THEN** 该实例仍归并为同一线程块，run 明细区只挂载一份，覆盖其全部终态 run
