## ADDED Requirements

### Requirement: 流式 token 批量节流
系统 SHALL 将同一会话的流式 token 累积缓冲，并以浏览器动画帧（requestAnimationFrame）为节拍提交，任一帧内对同一会话最多触发一次状态更新与渲染。

#### Scenario: 高频 token 输入只产生每帧一次渲染
- **WHEN** 后端在一个动画帧间隔内连续发送多个 `token` 事件
- **THEN** 系统在该帧内只对会话状态提交一次，累积的所有 token 合并为一次追加，不逐个触发渲染

#### Scenario: 节流不丢内容
- **WHEN** token 在多个帧内持续到达
- **THEN** 每个 token 都最终出现在流式内容中，无 token 被丢弃

### Requirement: 已完成段落增量渲染
系统 SHALL 仅对新增的已完成段落执行 Markdown 解析与渲染；已渲染的段落在其内容未变化时 MUST NOT 因新 token 到达而重新解析。

#### Scenario: 新 token 不触发旧段落重解析
- **WHEN** 流式过程中已有 N 个已完成段落，随后又到达新 token 并产生新段落
- **THEN** 仅新增段落被解析/挂载，已有 N 个段落复用之前的渲染结果

#### Scenario: 段落具备稳定标识
- **WHEN** 已完成段落数量随流式增长
- **THEN** 每个段落使用单调稳定的 key（如起始字符偏移），复用关系不因追加而错位

### Requirement: 流式收尾立即刷新缓冲
系统 SHALL 在流式结束、出错或被中止时，立即同步刷新尚未提交的 token 缓冲，确保尾部内容不丢失、不延迟。

#### Scenario: 正常结束时刷新尾部
- **WHEN** 收到 `done` 事件且缓冲中仍有未提交 token
- **THEN** 系统在处理该事件前同步提交剩余 token

#### Scenario: 出错或中止时刷新尾部
- **WHEN** 收到 `agent_error` 事件或用户主动 abort
- **THEN** 系统同步提交剩余 token 后再清理流式状态，不产生内容截断
