# session-context-usage

## Purpose

定义普通会话持久化上下文快照的查询、展示与 turn 收尾刷新行为，确保上下文用量来自权威输入预算观测，并在快照不可用或尚未落库时避免伪造数值。

## Requirements

### Requirement: 普通会话通过 API 分区读取持久化上下文快照
系统 SHALL 使用 `apiGet` 请求 `GET /api/v1/sessions/{session_id}/context-usage`，并以 `['context-usage', sessionId]` 作为 React Query 缓存键。查询 SHALL 只在活动会话为真实普通会话时启用，并 SHALL 在打开和重新聚焦时刷新。草稿哨兵与 scheduled-session MUST NOT 请求该普通会话端点，会话删除后 SHALL 移除对应查询缓存。

#### Scenario: 打开普通会话读取快照
- **WHEN** 用户打开一个已存在的普通会话
- **THEN** 系统通过 API base 查询该会话的 context-usage
- **AND** 查询结果按会话 id 独立缓存

#### Scenario: 草稿与任务会话不查询
- **WHEN** 活动会话为草稿哨兵，或用户查看 scheduled-session 历史
- **THEN** 系统不发起普通会话 context-usage 请求

#### Scenario: 聚焦与删除生命周期
- **WHEN** 用户重新聚焦普通会话，或删除该会话
- **THEN** 聚焦时重新读取最新快照
- **AND** 删除时移除该会话的上下文缓存，不把旧数据用于其他界面

### Requirement: 可用快照按输入预算展示上下文用量
当响应为 `available:true` 时，系统 SHALL 以 `context_tokens / input_budget_tokens` 计算使用占比，视觉进度 SHALL 限制在 0% 至 100%，并 SHALL 展示服务端 `remaining_tokens`（包括零）。`max_context_tokens` SHALL 仅作为硬窗口信息，MUST NOT 替代输入预算作为占比分母。展示 SHALL 保留模型、run id 和 `measured_at`，明确数据属于最近已持久化 turn 的最后一轮 provider 观测。

#### Scenario: 正常快照显示预算与剩余量
- **WHEN** 快照包含 `context_tokens=90000`、`input_budget_tokens=159904`、`remaining_tokens=69904`
- **THEN** 指示器显示约 56% 的输入预算已使用
- **AND** 详细信息显示剩余 69904 tokens、对应模型、run id 和测量时间

#### Scenario: 零剩余量与超预算不显示负数
- **WHEN** 快照的 `remaining_tokens` 为 0，或 `context_tokens` 不小于 `input_budget_tokens`
- **THEN** 指示器显示剩余 0，视觉进度最多为 100%
- **AND** 不显示负剩余量或负使用占比

#### Scenario: 硬窗口不参与占比分母
- **WHEN** 同一快照同时包含 `max_context_tokens=200000` 与 `input_budget_tokens=159904`
- **THEN** 使用占比仍以 159904 为分母
- **AND** 不以 200000 计算一个看似更低的占用率

### Requirement: 快照不可用时不得伪造或回退数值
当响应为 `available:false` 时，系统 SHALL 隐藏上下文数值指示，MUST NOT 显示 0% 已用、全部空间可用或根据当前模型目录推导的预算；同时 SHALL 在真实普通会话头部显示明确的“暂无快照”状态与说明，不得把整个上下文入口静默隐藏。初次加载尚未得到响应、空会话和草稿 SHALL 保持无指示器。最新不可用响应 SHALL 取代此前可用快照的展示，不得回退到更早 run 的数值。运行中的流式 token MUST NOT 直接驱动该指示器，累计 `total_tokens` MUST NOT 被当作上下文大小。

#### Scenario: 新会话或旧结构行没有可用快照
- **WHEN** 端点返回仅含 `available:false` 与 `session_id` 的响应
- **THEN** 指示器显示“暂无快照”及说明，但不展示使用比例、进度条或剩余 token 数值
- **AND** 聊天与消息发送继续正常工作

#### Scenario: 最新行不可用而缓存中有旧快照
- **WHEN** 缓存此前显示 run A 的有效快照，最新响应针对更新行返回 `available:false`
- **THEN** 系统以“暂无快照”替换旧 run A 的数值
- **AND** 不回退显示更早有效 run 的预算或余量

#### Scenario: 新 turn 正在流式输出
- **WHEN** 新 turn 尚未产生持久化 usage，而 token 持续到达
- **THEN** 指示器至多继续显示最近已持久化 run 的快照及其测量时点
- **AND** 不按 token 数或累计成本实时增加占用比例

### Requirement: turn 收尾按 run id 有界刷新快照
普通 turn 流自然结束或 attach 回落后，系统 SHALL 在历史 reconcile 的统一收尾阶段触发上下文刷新，且 MUST NOT 阻塞流式状态清理或后续 run 接管。已知刚完成的 run id 时，系统 SHALL 最多进行 4 次新鲜读取、每次关闭 React Query 自动重试并间隔约 300ms；当响应 `available:true` 且 `run_id` 等于目标 run 时 SHALL 提前停止。读取旧 run、暂不可用或单次请求失败 SHALL 只触发有限重试，耗尽后 SHALL 停止并保留最后一次实际服务端结果，不得构造目标 run 的假快照。

#### Scenario: done 后第一次仍读到上一轮
- **WHEN** run B 收尾后的第一次读取仍返回 run A，第二次读取返回 `available:true` 且 run id 为 B
- **THEN** 系统进行第二次读取后更新为 B 的快照并停止重试
- **AND** 不把 A 标记为刚完成的 B

#### Scenario: usage 持续未落库
- **WHEN** 有界刷新期间始终返回旧 run、不可用快照或请求失败
- **THEN** 系统在最多 4 次读取后停止，不形成常驻轮询
- **AND** 后续打开或聚焦会话仍可重新读取权威快照

#### Scenario: run 身份未知
- **WHEN** 终局路径无法解析刚完成的 run id
- **THEN** 系统只失效上下文查询，不伪造 run 匹配结论或启动身份匹配轮询
