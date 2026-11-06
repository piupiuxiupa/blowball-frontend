# chat-turn-lifecycle

## Purpose

定义客户端 turn 生命周期管理行为（对应后端 turn-detach-resume 契约）：run id 的捕获与跟踪、显式取消（含取消后部分输出的收尾）、attach/续传（打开 generating 会话、Last-Event-ID、410 回落）、409 撞忙转 attach、会话列表 generating 指示与取消入口，以及本地断开 = 仅 detach 的语义。

## Requirements

### Requirement: 跟踪会话的活跃 run id
系统 SHALL 为每个存在运行中 turn 的会话维护当前活跃 run id，并 SHALL 从以下渠道获取：已确认开始执行的发送路径的 `X-Run-Id`（以执行事件的 `meta.run_id` 兜底）、409 `SESSION_BUSY` 响应 body 的 `run_id`、会话列表在 `generating: true` 时携带的 `run_id`、单会话详情在 `generating: true` 时携带的 `run_id`。仅 received/queued 的响应头和事件 SHALL NOT 覆盖当前活跃 run。终局回调 SHALL 只清除其拥有且仍匹配的 run 登记，不清除已接管的新 run。

#### Scenario: 发送时记录 run id
- **WHEN** 用户发送消息、流式响应确认该消息开始执行
- **THEN** 系统从响应头或执行事件记录该会话的活跃 run id，供取消与续传使用

#### Scenario: reload 后从会话列表恢复 run id
- **WHEN** 页面重新加载后用户打开一个 generating 为 true 的会话
- **THEN** 系统从该会话列表项的 run_id 字段恢复 attach 目标，无需客户端持久化

#### Scenario: 列表缓存过期时由单会话详情校正
- **WHEN** 用户切换到的会话已在别处开始生成，但本地会话列表缓存尚未反映
- **THEN** 系统经单会话详情读取 generating 和 run_id，据此建立 attach

#### Scenario: 等待 run 不覆盖执行 run
- **WHEN** A 已是当前活跃 run，另一提交的响应头及 queued 帧携带 B 的 run id
- **THEN** 系统把 B 作为等待项身份，当前活跃 run 和停止目标仍为 A

#### Scenario: 旧 run 迟到收尾
- **WHEN** A 的异步收尾回调到达时 B 已成为当前活跃 run
- **THEN** A 的清理不删除 B 的 run 登记、控制器、游标或流式分段

### Requirement: 停止按钮显式取消 turn
用户触发停止时，系统 SHALL 调用已捕获的当前活跃 run 对应的 cancel 端点（幂等），且 SHALL NOT 本地断开流；系统 SHALL 继续消费该 run 的 SSE 至终局并重拉确认部分输出落库。取消端点失败 SHALL 提示错误且不改变流状态。停止当前 run SHALL NOT 清空其他 queued 消息；停止中状态 SHALL 绑定取消目标 run，并在目标终局或 active run 变化时复位。

#### Scenario: 点击停止调用取消端点
- **WHEN** 流式进行中用户点击停止按钮
- **THEN** 系统对该会话的活跃 run id 发起取消请求，不本地 abort 流连接

#### Scenario: 取消后部分输出落显
- **WHEN** 取消被后端接受并下发终局事件
- **THEN** 已生成的部分输出经历史重拉确认落库后保留展示，已接受的用户消息不回滚

#### Scenario: 重复点击停止无副作用
- **WHEN** 用户在取消生效前再次触发停止
- **THEN** 系统对同一目标 run 的幂等操作不产生重复状态变化或误取消其他 run

#### Scenario: 当前停止不删除等待队列
- **WHEN** A 正在执行且 B/C 等待，用户停止 A
- **THEN** 系统只取消 A，保留 B/C 并继续发现后端随后执行的 run

#### Scenario: 下一轮可以再次停止
- **WHEN** A 已被取消收尾，B 接管成为活跃 run
- **THEN** A 的停止中状态复位，新的停止操作只针对 B

### Requirement: 撞忙（409 SESSION_BUSY）自动转 attach
发送请求返回 409 SESSION_BUSY 且 body 携带 run_id 时，系统 SHALL 静默接入该 run 或复用已有订阅，SHALL 移除本次未被接受请求的乐观用户消息（如有）并保留未发送输入。系统 SHALL NOT 回滚整个历史快照或清除无关的当前流。系统 SHALL 用非弹窗提示说明本条未被接受；QUEUE_FULL SHALL NOT 被误判为此兼容路径。

#### Scenario: 发送撞忙自动接入运行中 turn
- **WHEN** 用户向已有运行中 turn 的会话发送消息，后端返回 409 SESSION_BUSY
- **THEN** 系统撤回本请求的乐观表示并自动 attach 到响应 run_id，无弹窗打断且未发送内容保留

#### Scenario: 已有订阅不重复接入
- **WHEN** SESSION_BUSY 返回的 run 已由本端消费
- **THEN** 系统继续原订阅，不清其输出、不为相同 run 建立重复连接

### Requirement: 打开生成中会话自动 attach
用户切换到 generating 为 true 且已知 run id 的会话时，系统 SHALL 通过该 run 的 events 端点接入（重放加 live），并 SHALL 防止重复订阅。run 发现 SHALL 保留「列表缓存快路径、详情权威裁决」双通道及聚焦重取；attach 本身 SHALL NOT 禁用会话编辑和继续提交。旧订阅结束或详情更新为后续 run 时 SHALL 重新判断候选 run。

#### Scenario: 打开生成中会话接入事件流
- **WHEN** 用户点击一个 generating 为 true 的会话
- **THEN** 系统建立 attach 并由重放重建流式分段，输入框仍可编辑和提交

#### Scenario: 列表缓存已带 run id 时先行接入
- **WHEN** 会话切换瞬间列表缓存已有 generating 和 run_id
- **THEN** 系统不等详情往返即接入；过时缓存导致已终局时由现有 410/404 回落兜底

#### Scenario: 聚焦发现查看中会话开始生成
- **WHEN** 用户查看的会话在别处开始生成，聚焦触发详情重取
- **THEN** 系统接入其活跃 run，无需发送消息撞 409 才能发现

#### Scenario: 不重复订阅同一 run
- **WHEN** attach 建立后列表刷新或组件重新判断
- **THEN** 系统不重复建立同一活跃 run 的订阅

#### Scenario: 旧订阅释放后重评估候选
- **WHEN** 详情已返回 B，但当时 A 的订阅尚未释放；随后 A 完成收尾
- **THEN** 系统重新判断并接入 B，不依赖用户切换会话或重新聚焦

### Requirement: attach 的续传与回落
attach 网络或非终局断开时，系统 SHALL 以固定的 session/run 身份携带该 run 的 Last-Event-ID 有限次重连。重连耗尽或 410/404 时 SHALL 回落普通历史并失效会话列表、详情和队列缓存，清理只作用于该订阅拥有的运行状态。系统 SHALL NOT 将旧 run 的游标用于新 run；active attach 重放 queued 前缀 SHALL 继续消费后续执行事件而非再次 detach。

#### Scenario: 流异常后按事件粒度续传
- **WHEN** attach 中断且其 run 未终局
- **THEN** 系统以该 run 最后收到的事件 id 重连，不因其他提交或 run 的游标而漏事件/重复展示

#### Scenario: 超出保留窗口回落历史
- **WHEN** attach 请求返回 410
- **THEN** 系统读取持久化历史并失效相关缓存，不残留其拥有的流式分段，也不清除后来接管的其他 run

#### Scenario: 新 run 不复用旧游标
- **WHEN** A 结束后系统接入 B
- **THEN** B 使用自己的续传游标或从完整日志开始，不携带 A 的 Last-Event-ID

#### Scenario: 执行中的 queued run 重放前缀
- **WHEN** 会话详情已确认 B 为活跃 run，B 的 attach 日志先重放 queued 再到达 agent_start
- **THEN** 系统不把 queued 渲染成正文、不重新断开，正常消费 B 的执行事件

### Requirement: 本地断开仅为 detach
本地断开 SSE（切换路由、关闭页面、组件清理或新提交在 queued 确认后释放等待连接）SHALL NOT 触发取消，SHALL NOT 清空其他活跃 run 的流式状态；运行中 turn 继续执行，已接收的 queued 消息继续等待。移除等待消息 SHALL 使用显式 cancel 端点。

#### Scenario: 离开后 turn 继续
- **WHEN** 流式进行中用户切走或关闭页面
- **THEN** turn 在服务端继续生成，重新打开会话时经 attach 恢复输出

#### Scenario: 释放等待订阅不撤回
- **WHEN** queued 消息已确认后前端 detach 其等待流
- **THEN** 服务端消息保留在队列并能继续执行，当前其他活跃流不受影响

### Requirement: 会话列表生成中指示与取消入口
会话列表 SHALL 为 `generating: true` 的会话呈现生成中指示，并在该状态下提供取消入口（不依赖打开该会话）；会话列表查询 SHALL 在窗口重新聚焦时刷新（独立于全局聚焦重取策略），使 detach 后回页能感知 turn 结束。

#### Scenario: 生成中会话显示徽标
- **WHEN** 会话列表某项 `generating: true`
- **THEN** 该项呈现生成中徽标指示

#### Scenario: 从列表取消未打开的会话
- **WHEN** 用户在某 `generating: true` 会话的列表项上触发取消
- **THEN** 系统对该项的 run id 调用取消端点，徽标随列表刷新消失

#### Scenario: 窗口聚焦刷新会话列表
- **WHEN** 用户离开后回到页面、窗口重新聚焦
- **THEN** 会话列表重新拉取，`generating` 状态与实际运行状态对齐

### Requirement: 后端连续执行可自动衔接
系统 SHALL 在入队、撤回、活跃 run 终局以及等待/执行阶段的有界探测中刷新队列和会话状态，并 SHALL 在旧 run 的历史收尾后接入后端当前活跃 run。系统 SHALL 保持同一会话至多一个活跃输出订阅，SHALL 在每轮收尾时按 run 身份对齐历史、等待展示与实时输出；后续 run 已快速完成时 SHALL 通过历史重取补齐结果。

#### Scenario: FIFO 后续 run 自动接入
- **WHEN** A 结束且后端把等待的 B 继续为活跃 run
- **THEN** 系统完成 A 的收尾并自动接入 B，B 从等待展示中退出，由实际历史/实时消息接管而不重复气泡

#### Scenario: 后续执行快于探测
- **WHEN** B 在下一次状态探测前已经执行并终局
- **THEN** 系统通过消息历史展示 B 的结果，等待展示收敛，不依赖曾经持有 B 的实时连接

#### Scenario: 非活动会话返回后恢复
- **WHEN** 用户切走期间后端继续完成多个 queued run，随后重新打开该会话
- **THEN** 系统以队列、详情和消息历史恢复最新状态，不要求后台持续轮询所有隐藏会话
