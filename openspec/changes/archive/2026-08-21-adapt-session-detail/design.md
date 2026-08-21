# Design: adapt-session-detail

## Context

后端新增单会话读取接口 `GET /api/v1/sessions/{session_id}`（`SessionDetail`：列表项超集 + `create_time`），契约已同步（`openapi.yaml` 复制、`openapi.d.ts` 重新生成完毕）。后端在契约里把 `SessionDetail.run_id` 标注为 "the reload discovery path"——它就是为 run 发现而生的。

前端现状（`src/hooks/use-turn-lifecycle.ts` 的 `useAttachRun`）：run id 发现**只**在 `activeSessionId` 变化时读 `['sessions']` 列表缓存。两个缺口：

1. SPA 内部切换会话不触发 window focus → 列表不重取 → 缓存过期时读到 `generating: false`，不 attach（用户对着静止界面，直到发送撞 409 兜底）。
2. 正在查看的会话在他处开始生成：聚焦重取列表只更新徽标，effect 依赖只有 `activeSessionId`，不重新判断 attach。

既有安全网：`attachToRun` 的 `turnRuns` 防重、404/410 回落 `fallbackToHistory`、发送路径 409 转 attach——任何过时探测都无副作用，这是本设计敢做「新鲜探测」的前提。

## Goals / Non-Goals

**Goals:**
- 切换会话的瞬间获得新鲜的 `generating`/`run_id`（不依赖列表缓存新鲜度）
- 查看中会话在他处开始生成时，聚焦即自动 attach（不再只靠 409 兜底）
- 保留列表缓存的即时性：已带 run id 时先行 attach，不等详情往返

**Non-Goals:**
- `create_time` 的 UI 消费（无界面诉求，仅导出类型）
- 会话列表徽标/取消入口改造（列表仍是侧栏清单，本变更不动其 UI）
- 发送链路的 413 `REQUEST_TOO_LARGE` / 400 `CONTENT_TOO_LONG` 适配（同批契约混入，独立 change）
- 深链/路由级会话地址（当前无 `/s/:id` 路由，不需要「无列表渲染单会话」）

## Decisions

### D1: 双通道发现——缓存先行、详情裁决

attach 候选 run id 的选取规则：**单会话详情已加载时以其结果为权威**（`generating && run_id` 才接入，`generating: false` 时压制列表缓存的过时 `generating: true`）；**详情未加载时列表缓存快路径先行**（即时接入，不等详情往返）。两通道共用既有 `turnRuns[sessionId]` 防重，不会重复订阅。

*备选 1*：仅详情单通道。否决——每次切换都为一个 RTT 的 attach 延迟买单，而列表缓存（focus 重取维护）多数时候已是对的；快路径把延迟归零，过时代价由回落兜底。
*备选 2*：保留仅列表通道、effect 依赖加列表数据。否决——修不了缺口 1：SPA 内部切换时列表依旧不重取，没有新鲜数据源就修不了「缓存过期漏报」。

### D2: 详情查询内嵌于 `useAttachRun`（单一发现拥有者）

`useAttachRun` 直接内嵌 `useQuery`：key `['session', activeSessionId]`，`queryFn` 走 `apiGet`（**API base**——单会话读取是 CRUD 端点，非流式、不落 agent 分区，这点与 events/cancel 相反），`enabled: activeSessionId !== null`（有界请求量：一次切换/一次聚焦各最多一个 GET），`refetchOnWindowFocus: true`（豁免理由同 `['sessions']`：不碰文件内容，见 `query-client.ts`）。`staleTime` 维持默认 0——「每次启用即新鲜探测」正是本变更想要的语义。effect 依赖 `activeSessionId` + 详情数据对象：聚焦重取把详情刷成 `generating: true` 时引用变化，直接驱动 attach（补缺口 2）。

*备选*：独立 `useSessionDetail` hook 放 `use-sessions.ts`、由 `chat-panel.tsx` 挂载。否决——发现状态分散两文件、多一个挂载点；内嵌后 `chat-panel.tsx` 零改动，发现逻辑单点收敛。

### D3: 失效协同——`['session', id]` 与 `['sessions']` 同生同灭

attach 终局收尾（`attachToRun` 的 `finally`）与 `fallbackToHistory` 在既有失效 `['sessions']` 处同步失效 `['session', sessionId]`，防止详情缓存滞留 `generating: true` 导致反复探测。

删除会话（`useDeleteSession` 的 purge）**不**清理该 key：key 含已删会话 id、查询仅对活动会话启用，活动会话已被切走，滞留数据不可达。

### D4: `create_time` 只导出不消费

`SessionDetail` 类型在 `api.ts` re-export（维持 `paths` 不出 `api.ts` 惯例），`create_time` 字段暂无消费点，不做 UI。

## Risks / Trade-offs

- [快路径 attach 到已终局的 run] → 一次注定失败的 events 请求（404/410）+ 回落重取。代价有界且静默，可接受。
- [详情聚焦重取与 attach 建立并发] → `turnRuns` 占位防重先于任何 await，无竞态窗口。
- [每次切换会话多一次 GET] → 单会话读取轻量（一次 claim 读 + 一次标题读），有界于用户切换频率。
- [详情与列表徽标短暂不一致（详情先回 idle、列表仍 generating）] → 徽标走列表 focus 重取收敛，最多差一个聚焦周期，无行为影响。
