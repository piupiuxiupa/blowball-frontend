# Proposal: adapt-session-detail

## Why

后端新增单会话读取接口（契约已复制进 `openapi.yaml` 并重新生成类型）：`GET /api/v1/sessions/{session_id}` 返回 `SessionDetail`——会话列表项的超集（`generating`/`run_id` 语义相同），唯一新增字段是 `create_time`。后端在契约里明确把 `run_id` 标注为 "the reload discovery path"：这个接口就是为 turn-detach-resume 的 run 发现而生的。

而现有发现路径（`useAttachRun`，adapt-turn-detach-resume 引入）有两个真实缺口：

1. **SPA 内部切换不触发列表重取**：`useAttachRun` 在会话切换时读 `['sessions']` 缓存取 run id，但侧栏点击切换不产生 window focus 事件、列表不重取。缓存过期时（如该会话已在另一标签页开始生成）读到 `generating: false`，不 attach——用户对着静止的聊天界面，直到发送撞 409 才兜底接入。
2. **查看中会话在他处开始生成**：effect 依赖只有 `activeSessionId`，聚焦重取列表只更新徽标，不会重新判断 attach。同样只剩 409 兜底。

单会话详情接口恰好补这两个洞：在打开（切换/聚焦）会话的瞬间做一次**新鲜探测**，不依赖列表缓存的新鲜度。现有 `attachToRun` 的 `turnRuns` 防重与 404/410 回落历史，使探测结果过时也无副作用——升级天然安全。

## What Changes

- `api.ts` 导出 `SessionDetail` 类型（生成的类型目前无人 re-export）。
- 新增单会话详情查询：query key `['session', sessionId]`，`GET /api/v1/sessions/:session_id`，仅在会话为**活动会话**时启用（有界请求量：每次切换 + 每次聚焦各一次）；单独开启 `refetchOnWindowFocus`（与 `['sessions']` 同一豁免理由——不碰文件内容）。
- `useAttachRun` 重构：run id 发现改为**双通道**——列表缓存（快路径）+ 单会话详情查询（新鲜校正），effect 同时以两者为依赖——
  - 快路径：切换瞬间列表缓存已带 `generating && run_id` 即先行 attach，不等详情往返（缓存过时、run 已终局时由既有 404/410 回落兜底）；
  - 切换时详情即取即用，校正缓存漏报（缓存过期未反映他处开始生成，补缺口 1）；
  - 聚焦重取把正在查看的会话刷成 `generating: true` 时同样触发 attach（补缺口 2，徽标之外行为闭环）；
  - 判断条件不变：`generating && run_id && !turnRuns[sessionId]`（`turnRuns` 防重保证快路径与详情通道不重复订阅）。
- 缓存协同：attach 终局（`finally` 失效 `['sessions']` 处）与回落路径（`fallbackToHistory`）同步失效 `['session', sessionId]`，防止详情缓存滞留 `generating: true` 导致反复探测。
- 不受影响：发送路径的 `X-Run-Id`/`meta.run_id` 捕获、409 撞忙转 attach、会话列表徽标与取消入口（列表仍是侧栏的粗粒度清单，详情查询是活动会话的精确探测）。

## Capabilities

### Modified Capabilities

- `chat-turn-lifecycle`：
  - 「跟踪会话的活跃 run id」的获取渠道**新增单会话详情接口**（切换/聚焦时的新鲜读取），与既有列表缓存渠道互补——缓存先行、详情校正；
  - 「打开生成中会话自动 attach」的触发时机从「切换会话时」扩展为「切换会话，或聚焦重取发现正在查看的会话 generating」。

## Impact

- **代码**：`src/lib/api.ts`（`SessionDetail` 类型导出）、`src/hooks/use-turn-lifecycle.ts`（`useAttachRun` 重构、终局/回落失效范围）。改动面收敛在两个文件。
- **契约**：`openapi.yaml` 已同步、`src/lib/openapi.d.ts` 已重新生成（前置完成，本变更不含后端改动）。
- **非目标**：`create_time` 的 UI 消费（当前无界面需要，等有详情/信息面板诉求再说）；同一契约同步里混入的 413 `REQUEST_TOO_LARGE` / 400 `CONTENT_TOO_LONG`（add-input-token-limit，发送链路错误处理）属另一变更，另行提案。
