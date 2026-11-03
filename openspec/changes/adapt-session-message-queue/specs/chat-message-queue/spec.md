## ADDED Requirements

### Requirement: 运行中会话可继续编辑和提交消息
系统 SHALL 在真实会话存在活跃 run 或 attach 订阅时允许编辑正文、选择模型/思考等级和附加上下文/图片，并 SHALL 分离发送与停止当前 run 的操作入口。系统 SHALL 只在对应消息的建会话、上传或等待提交确认阶段阻止重复提交；运行状态本身 SHALL NOT 禁用输入。提交 SHALL 使用发送时捕获的正文、上下文、图片和模型参数快照。

#### Scenario: 生成中继续输入并发送
- **WHEN** 用户正在查看一个持续输出的会话并输入另一条消息
- **THEN** 用户可以编辑和提交，当前输出继续，停止入口仍只针对当前活跃 run

#### Scenario: attach 期间附加图片和上下文
- **WHEN** 用户打开生成中会话后通过 attach 接入并附加图片、文件或划词引用
- **THEN** 附加入口可用，发送沿用图片先上传和上下文序列化，等待消息携带本次快照

#### Scenario: 提交中防重复
- **WHEN** 本条消息还在上传、创建会话或等待服务端确认
- **THEN** 系统阻止该提交的重复触发，但不把其他会话的输入和发送动作全局锁住

### Requirement: 通过 queued SSE 确认消息已被接受
系统 SHALL 支持 `POST /sessions/{session_id}/messages` 返回的 `200 text/event-stream` 和 `queued` 事件，SHALL 用其 `meta.run_id`（以 `X-Run-Id` 兜底）标识等待项，并 SHALL 把它视为已接受但尚未执行。系统 SHALL NOT 要求 JSON/202 回执，SHALL NOT 把等待 run 登记为当前活跃 run或把该事件渲染成 Agent 正文。新提交收到 queued 确认后 SHALL 能完成提交状态并 detach 等待连接，而不取消服务端消息。

#### Scenario: 已有 run 时接受等待消息
- **WHEN** 当前 run A 仍在输出，提交消息收到标识 run B 的 queued 帧
- **THEN** 系统显示 B 的等待状态并允许下一次提交，A 的登记、输出和停止目标保持不变

#### Scenario: queued 帧没有 agent
- **WHEN** queued 事件仅携带 type 和 meta，没有 agent 或 content
- **THEN** 系统正确确认等待项，不创建空 Agent 段、不抛出渲染错误

#### Scenario: 接受之后断开等待连接
- **WHEN** 新提交已经收到 queued 确认，前端释放其等待 SSE
- **THEN** 系统不发 cancel、不显示提交失败，后端等待项随后可以继续执行

### Requirement: 等待消息使用独立 FIFO 展示
系统 SHALL 从 `GET /sessions/{session_id}/queue` 按服务端顺序展示等待项，并 SHALL 以 run id 去重。展示 SHALL 使用队列项的原始 content、图片引用、已知模型和入队时间；附加上下文 SHALL 沿用既有解析/展示，图片 SHALL 使用会话附件 content 端点。`queue_position` SHALL 仅作为入队时的参考值。等待项 SHALL NOT 被写入消息历史缓存、计入已执行的用户回合导航或改变划词引用的 turn 编号。

#### Scenario: 多条等待项保持顺序
- **WHEN** 服务端队列依次返回 B、C、D，且本地也已有 B 的确认项
- **THEN** 系统按 B、C、D 展示且 B 不重复，不按过时 queue_position 重排

#### Scenario: 等待消息携带图片与上下文
- **WHEN** 队列项含附加上下文内容和 attachments 引用
- **THEN** 系统显示用户正文、上下文和可访问图片，不把原始 XML 或模型图片占位文本当成图片来源

#### Scenario: 当前回复与历史导航不受等待项影响
- **WHEN** A 正在流式输出，B 和 C 等待执行
- **THEN** A 的输出仍属于当前已开始的用户回合，历史导航中不出现 B/C 的未执行回合锚点

### Requirement: 刷新与会话切换可恢复等待状态
系统 SHALL 在打开或重新聚焦真实会话时查询其队列与会话运行状态，并 SHALL 在等待/执行阶段对当前可见会话进行有界刷新。`queued_count` 省略 SHALL 按零展示，但 SHALL NOT 被当成队列能力关闭的证明。草稿哨兵 SHALL NOT 发起队列或会话详情请求。单次空队列快照 SHALL NOT 被当成运行完成或撤回成功的证明。

#### Scenario: reload 恢复等待列表
- **WHEN** 页面刷新后用户重新打开含等待消息的会话
- **THEN** 系统通过 queue 端点重建等待项，不依赖旧页面的 mutation、流连接或本地持久化状态

#### Scenario: 省略计数仍可发送
- **WHEN** 会话详情未携带 queued_count 且当前 run 正在执行
- **THEN** 系统仍允许提交并根据实际 SSE 或错误响应确认是否接受，不预先判断能力关闭

#### Scenario: 队列读取暂时返回空
- **WHEN** 当前有活跃 run，队列读取返回空 200
- **THEN** 系统不清当前 run 或输出、不宣布某等待项执行/撤回成功，并由后续探测恢复最新状态

#### Scenario: 草稿没有服务端队列
- **WHEN** 活动会话为草稿哨兵
- **THEN** 系统不请求草稿的 queue/detail，首次发送继续先创建真实会话再上传/提交

### Requirement: 可按等待项 run id 撤回消息
系统 SHALL 为等待项提供独立撤回操作，SHALL 调用其 `run_id` 对应的 cancel 端点并观察返回状态。返回 `cancelled` 才 SHALL 确认撤回成功；`queued`、`running` 或 `cancelling` SHALL 保持处理中并刷新状态、有限次重试或告知稍后再试。取消失败 SHALL 保留等待展示和可重试信息。撤回某项 SHALL NOT 取消当前 run 或其他等待项。

#### Scenario: 撤回仍在等待的消息
- **WHEN** 用户撤回 B 且端点返回 cancelled
- **THEN** 系统确认 B 被撤回并刷新队列，当前 A 和其他等待项 C 不受影响

#### Scenario: 撤回与开始执行竞争
- **WHEN** 撤回响应为 queued 或 cancelling，或者刷新发现 B 已开始执行
- **THEN** 系统不立即伪称撤回成功，继续围绕同一 B 的身份确认/重试，不误取消后来接管的 C

#### Scenario: 消息已执行完毕
- **WHEN** 撤回响应为 done、error 或 interrupted
- **THEN** 系统刷新实际状态并说明该项已不是可撤回的等待消息，不报告未发生的撤回成功

#### Scenario: 撤回请求失败
- **WHEN** 撤回 B 的网络或服务端请求失败
- **THEN** 系统显示失败原因并允许重试，不移除其他等待项或清除当前输出

### Requirement: 排队提交失败不污染当前运行或新草稿
系统 SHALL 对 `QUEUE_FULL`、`SESSION_BUSY`、参数/附件拒绝、鉴权及请求级网络错误保留未接受的发送快照，并 SHALL 向用户区分「未发送」与「已入队」。`SESSION_BUSY` SHALL 保留既有静默 attach/防重兼容。失败与成功回调 SHALL 仅影响原始会话和匹配的草稿修订，SHALL NOT 回滚整个历史缓存、覆盖新草稿或清除正在执行的流。系统 SHALL NOT 自动重试 POST 造成重复消息。

#### Scenario: 队列已满
- **WHEN** A 正在输出且新提交返回 409 QUEUE_FULL
- **THEN** 系统保留输入及附件并提示等待或撤回后再试，A 的 run、游标和输出均保留，不自动 attach

#### Scenario: 部署尚未开启队列
- **WHEN** 提交返回 409 SESSION_BUSY 和当前 run id
- **THEN** 系统保留未发送内容，静默 attach 或复用既有订阅，并以非弹窗方式告知本条未被接受

#### Scenario: 旧请求结果不覆盖另一会话的草稿
- **WHEN** A 的提交尚未确认，用户切到 B 修改正文或附件后 A 返回失败或成功
- **THEN** 结果只更新 A 的提交状态，不清空、恢复或替换 B 的新草稿

#### Scenario: 已接受后发生连接异常
- **WHEN** 消息已有服务端接受证据，后续订阅发生网络中断
- **THEN** 系统按 queue/detail/history 或 attach 恢复，不把它当成未发送进行自动重复 POST
