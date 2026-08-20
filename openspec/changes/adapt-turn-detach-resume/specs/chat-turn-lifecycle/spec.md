# chat-turn-lifecycle Delta — adapt-turn-detach-resume

## ADDED Requirements

### Requirement: 跟踪会话的活跃 run id
系统 SHALL 为每个存在运行中 turn 的会话维护当前 run id，并 SHALL 从以下渠道获取：发送路径的 `X-Run-Id` 响应头（以首个 `agent_start` 事件的 `meta.run_id` 为兜底）、409 `SESSION_BUSY` 响应 body 中的 `run_id`、会话列表项在 `generating: true` 时携带的 `run_id`。turn 到达终局后系统 SHALL 清除该会话的 run id 记录。

#### Scenario: 发送时记录 run id
- **WHEN** 用户发送消息、流式响应建立
- **THEN** 系统从 `X-Run-Id` 响应头记录该会话的 run id，供取消与续传使用

#### Scenario: reload 后从会话列表恢复 run id
- **WHEN** 页面重新加载后用户打开一个 `generating: true` 的会话
- **THEN** 系统从该会话列表项的 `run_id` 字段恢复 attach 目标，无需客户端持久化

### Requirement: 停止按钮显式取消 turn
用户触发停止时，系统 SHALL 调用 `POST /sessions/:session_id/turns/:run_id/cancel`（幂等），且 SHALL NOT 本地断开流——取消后系统继续消费既有 SSE 流直至终局事件，随后走既有「重拉确认落库再清流式分段」的收尾。取消端点失败时系统 SHALL 向用户提示错误且不改变流状态。

#### Scenario: 点击停止调用取消端点
- **WHEN** 流式进行中用户点击停止按钮
- **THEN** 系统对该会话的活跃 run id 发起取消请求，且不本地 abort 流连接

#### Scenario: 取消后部分输出落显
- **WHEN** 取消被后端接受、流下发终局事件
- **THEN** 已生成的部分输出经历史重拉确认落库后保留展示，乐观用户消息不回滚

#### Scenario: 重复点击停止无副作用
- **WHEN** 用户在取消生效前再次点击停止
- **THEN** 系统再次调用幂等的取消端点，不产生重复状态变化

### Requirement: 撞忙（409 SESSION_BUSY）自动转 attach
发送请求返回 409 `SESSION_BUSY` 且 body 携带 `run_id` 时，系统 SHALL 静默接入该 run 的事件流（attach），并 SHALL 回滚本次未被接受的乐观用户消息。

#### Scenario: 发送撞忙自动接入运行中 turn
- **WHEN** 用户向一个已有运行中 turn 的会话发送消息、后端返回 409 `SESSION_BUSY`
- **THEN** 系统回滚乐观用户消息并自动 attach 到 body 中 `run_id` 指示的运行中 turn，无弹窗打断

### Requirement: 打开生成中会话自动 attach
用户切换到一个 `generating: true` 且已知 run id 的会话时，系统 SHALL 通过 `GET /sessions/:session_id/turns/:run_id/events` 接入该 turn 的事件流（先重放后追 live），并 SHALL 防止对同一 run 重复建立订阅。attach 期间该会话的输入 SHALL 处于禁用状态。

#### Scenario: 打开生成中会话接入事件流
- **WHEN** 用户点击一个 `generating: true` 的会话
- **THEN** 系统建立 attach 订阅，流式分段自重放事件重建，输入框禁用

#### Scenario: 不重复订阅同一 run
- **WHEN** attach 已建立后列表刷新或组件重跑触发再次判断
- **THEN** 系统不重复建立同一 run 的订阅

### Requirement: attach 的续传与回落
attach 订阅中断（网络异常、非终局断开）时，系统 SHALL 携带最后收到的事件 id（`Last-Event-ID` 请求头）有限次重连；重连失败、或端点返回 410/404（run 已不可回放）时，系统 SHALL 回落为普通历史读取并失效会话列表缓存。

#### Scenario: 流异常后按事件粒度续传
- **WHEN** attach 订阅因网络异常中断且 turn 未到终局
- **THEN** 系统以最后收到的事件 id 重连，重放不重复、不丢事件

#### Scenario: 超出保留窗口回落历史
- **WHEN** attach 请求返回 410（run 保留窗口已过）
- **THEN** 系统改为读取该会话的持久化消息历史并失效会话列表缓存，不残留流式分段

### Requirement: 本地断开仅为 detach
本地断开 SSE 连接（切换路由、关闭页面、组件清理）SHALL NOT 触发取消，也 SHALL NOT 清空该会话的流式分段状态；turn 在服务端继续运行至终局。

#### Scenario: 离开后 turn 继续
- **WHEN** 流式进行中用户切走或关闭页面
- **THEN** turn 在服务端继续生成，重新打开该会话时经 attach 恢复输出

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
