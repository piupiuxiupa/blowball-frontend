## MODIFIED Requirements

### Requirement: 跟踪会话的活跃 run id
系统 SHALL 为每个存在运行中 turn 的会话维护当前 run id，并 SHALL 从以下渠道获取：发送路径的 `X-Run-Id` 响应头（以首个 `agent_start` 事件的 `meta.run_id` 为兜底）、409 `SESSION_BUSY` 响应 body 中的 `run_id`、会话列表项在 `generating: true` 时携带的 `run_id`、单会话详情接口（`GET /sessions/:session_id`）在 `generating: true` 时携带的 `run_id`。turn 到达终局后系统 SHALL 清除该会话的 run id 记录。

#### Scenario: 发送时记录 run id
- **WHEN** 用户发送消息、流式响应建立
- **THEN** 系统从 `X-Run-Id` 响应头记录该会话的 run id，供取消与续传使用

#### Scenario: reload 后从会话列表恢复 run id
- **WHEN** 页面重新加载后用户打开一个 `generating: true` 的会话
- **THEN** 系统从该会话列表项的 `run_id` 字段恢复 attach 目标，无需客户端持久化

#### Scenario: 列表缓存过期时由单会话详情校正
- **WHEN** 用户切换到的会话已在别处开始生成，但本地会话列表缓存尚未反映（SPA 内部切换不触发列表重取）
- **THEN** 系统经单会话详情接口读取到 `generating: true` 与 `run_id`，据此建立 attach

### Requirement: 打开生成中会话自动 attach
用户切换到一个 `generating: true` 且已知 run id 的会话时，系统 SHALL 通过 `GET /sessions/:session_id/turns/:run_id/events` 接入该 turn 的事件流（先重放后追 live），并 SHALL 防止对同一 run 重复建立订阅。run id 的发现 SHALL 为双通道：切换瞬间会话列表缓存已带 `generating: true` 与 `run_id` 时 SHALL 先行接入（不等详情往返）；单会话详情查询到达后 SHALL 以其结果为准（缓存先行、详情裁决）。窗口聚焦触发的单会话详情重取把正在查看的会话刷新为 `generating: true` 时，系统 SHALL 同样建立 attach。attach 期间该会话的输入 SHALL 处于禁用状态。

#### Scenario: 打开生成中会话接入事件流
- **WHEN** 用户点击一个 `generating: true` 的会话
- **THEN** 系统建立 attach 订阅，流式分段自重放事件重建，输入框禁用

#### Scenario: 列表缓存已带 run id 时先行接入
- **WHEN** 用户切换会话的瞬间列表缓存已带 `generating: true` 与 `run_id`
- **THEN** 系统不等单会话详情返回即建立 attach；若缓存过时致 run 已终局，由既有 410/404 回落兜底

#### Scenario: 聚焦发现查看中会话开始生成
- **WHEN** 用户正在查看的会话在别处开始生成、窗口重新聚焦触发单会话详情重取
- **THEN** 系统对正在查看的会话建立 attach，无需用户发送消息撞 409 兜底

#### Scenario: 不重复订阅同一 run
- **WHEN** attach 已建立后列表刷新或组件重跑触发再次判断
- **THEN** 系统不重复建立同一 run 的订阅

### Requirement: attach 的续传与回落
attach 订阅中断（网络异常、非终局断开）时，系统 SHALL 携带最后收到的事件 id（`Last-Event-ID` 请求头）有限次重连；重连失败、或端点返回 410/404（run 已不可回放）时，系统 SHALL 回落为普通历史读取并失效会话列表缓存与该会话的单会话详情缓存。

#### Scenario: 流异常后按事件粒度续传
- **WHEN** attach 订阅因网络异常中断且 turn 未到终局
- **THEN** 系统以最后收到的事件 id 重连，重放不重复、不丢事件

#### Scenario: 超出保留窗口回落历史
- **WHEN** attach 请求返回 410（run 保留窗口已过）
- **THEN** 系统改为读取该会话的持久化消息历史并失效会话列表与单会话详情缓存，不残留流式分段
