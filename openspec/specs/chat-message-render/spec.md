# chat-message-render

## Purpose

定义聊天消息的渲染行为，覆盖 Markdown 解析、代码高亮、消息块标识与长会话虚拟滚动，确保在长会话、流式更新、消息列表重拉取等场景下的渲染性能与稳定性。

## Requirements

### Requirement: Markdown 渲染按内容 memo 化
系统 SHALL 使 Markdown 渲染组件在输入内容（字符串）未变化时跳过重新解析与重新渲染。

#### Scenario: 已完成消息不因无关更新重渲染
- **WHEN** 一条已完成消息的内容未变化，但其所在列表因其他原因（如新消息追加、流式更新）重新渲染
- **THEN** 该消息的 Markdown 不被重新解析

#### Scenario: 内容变化时正常更新
- **WHEN** 消息内容字符串发生变化
- **THEN** Markdown 重新解析并以新内容渲染

### Requirement: 代码高亮轻量化与按内容缓存
系统 SHALL 仅按需注册代码高亮所需的语言集合，并按 (语言, 内容) 缓存高亮结果，使重复渲染不重复执行高亮。

#### Scenario: 未注册语言回退为纯文本
- **WHEN** 代码块声明的语言不在已注册集合中
- **THEN** 系统以可读、可复制的纯文本 `<pre>` 形式展示，不报错、不中断渲染

#### Scenario: 重复渲染不重复高亮
- **WHEN** 同一 (语言, 内容) 的代码块在内容未变化时被再次渲染
- **THEN** 系统复用上一次高亮结果，不重新执行语法高亮

#### Scenario: 打包体积收敛
- **WHEN** 构建生产包
- **THEN** 代码高亮相关产物不再包含未使用的全部语言定义（相对当前 Prism 全量包显著下降）

### Requirement: 消息块稳定标识与对象复用
系统 SHALL 为消息分组块提供稳定标识，并在底层消息未变化时复用相同的块对象引用，使消息列表重拉取后不触发已完成消息的全量重渲染。

#### Scenario: 重拉取不重渲染已完成消息
- **WHEN** 消息列表因 invalidate/refetch 重新加载，而已完成消息内容未变
- **THEN** 这些消息的块对象引用保持不变，对应组件跳过重渲染

#### Scenario: 内容真正变化时重渲染
- **WHEN** 某消息块底层内容发生变化（如错误信息追加）
- **THEN** 该块产生新引用并重新渲染

### Requirement: 长会话虚拟滚动
系统 SHALL 对消息列表实施虚拟滚动，仅渲染可视区域及其缓冲区内的消息块，使长会话（数百条消息）下 DOM 节点数与渲染开销保持有界。

#### Scenario: 长会话滚动流畅
- **WHEN** 会话包含大量消息块且用户滚动浏览
- **THEN** 仅可视区域附近的消息块被渲染，滚动不掉帧

#### Scenario: 流式尾行可见与自动滚动仍生效
- **WHEN** 流式回答持续输出且用户位于底部附近
- **THEN** 流式尾部内容被渲染并随输出自动滚动到底，行为与非虚拟化时一致

### Requirement: 按 agent 差异化渲染助手消息
系统 SHALL 按消息所属 agent 名采用不同渲染形态：Confucius（主编排 agent）的输出以全宽裸 Markdown 渲染，不套用消息气泡、头像与名字标签；子 agent（Chongzhi、Liang）的输出按调用身份（(agent, run_id) 复合键）各自渲染为独立气泡并默认折叠——并发同名子 agent 调用的交错行按各自 run id 归组，不拼入同一气泡。每个 agent 范围内的正文片段与工具调用 SHALL 按事件到达顺序内联渲染，不得把工具记录统一汇总到正文之后；tool_result SHALL 按 tool_call_id 合并到对应工具调用卡内，而不是渲染为独立结果卡。该规则对持久化消息与流式段统一生效。

子 agent 气泡在全局消息流中的位置 SHALL 跟随其父 invoke tool_call 的到达顺序：父 agent 在子 agent 开始前输出的内容位于子 agent 气泡之前；子 agent 结束后父 agent 继续输出的内容位于该气泡之后，不得因为按 agent 归组而把子 agent 气泡整体挪到父 agent 完整消息末尾。

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

#### Scenario: 子 agent 每次调用各自独立气泡
- **WHEN** 渲染 agent 为 Chongzhi 或 Liang 的助手消息
- **THEN** 每次 (agent, run_id) 调用各自渲染为一个独立气泡，不与 Confucius 或其他 agent 合并

#### Scenario: 并发同名调用的交错行按身份归组
- **WHEN** 历史消息中同名子 agent 两次调用（不同 run id）的行交错到达
- **THEN** 两次调用的行分别归入各自调用的气泡，同一气泡内不混入另一次调用的输出

#### Scenario: 子 agent 气泡默认折叠
- **WHEN** 子 agent 气泡首次渲染（含流式中正在输出的活动段）
- **THEN** 其正文默认处于折叠态，折叠态仅显示「名字 + 状态」指示

#### Scenario: 折叠态不渲染正文但持续累积
- **WHEN** 子 agent 气泡处于折叠态且仍在其回合内接收流式 token
- **THEN** 其正文不渲染，但内容持续累积；展开后可见已累积的全部正文并继续追加尾部

#### Scenario: 展开显示完整内容
- **WHEN** 用户展开一个子 agent 气泡
- **THEN** 气泡内显示该 agent 的完整思考过程，以及按事件顺序交替排列的 Markdown 正文与工具记录

#### Scenario: 状态指示随生命周期变化
- **WHEN** 子 agent 气泡的状态在 running / tool_call / idle / error 间变化
- **THEN** 折叠态头部与展开态分别显示对应的状态指示（如 spinner / 工具图标 / 完成 / 错误）
