# Design: lazy-session-creation

## Context

现状（`use-sessions.ts` / `session-list.tsx`）：「+」→ `createMutation.mutateAsync()` → `POST /api/v1/sessions` → invalidate 列表 → `setActiveSession(新 id)`。会话在用户输入任何内容前已落库。

发送链路现状（`message-input.tsx` / `use-send-message.ts`）：`handleSubmit` → `sendMessage({sessionId, content, model?, reasoningEffort?})`，乐观消息 onMutate 写 `['messages', sessionId]`，流式/取消/attach 生命周期全部 keyed by sessionId。

## Goals / Non-Goals

**Goals:**
- 「+」零网络请求；空会话仅在「用户确实发了消息」时创建
- draft 首条消息的编排不侵入既有发送路径（乐观消息零缓存迁移）
- draft 与既有按会话键控的状态（streamingSegments / turnRuns / messages 缓存）天然隔离
- 创建失败不丢用户输入

**Non-Goals:**
- 不做多 draft（同时只有一个）
- 不持久化 draft（reload 即弃，含输入框文本——textarea 本就是组件本地状态）
- 不做会话自动起名/改名（沿用后端默认标题与既有重命名）
- 不清理存量空会话（历史数据，另行处理）

## Decisions

### D1: draft 用 activeSessionId 哨兵值，不引入独立状态

`ui-store` 导出 `DRAFT_SESSION_ID = 'draft'`；draft 态即 `activeSessionId === DRAFT_SESSION_ID`。

*备选*：独立 `isDrafting` boolean（`activeSessionId` 保持 null）。否决——所有消费方（列表选中态、ChatPanel 分支、输入禁用判据）都得双字段判断；哨兵单字段让 draft 沿用全部「活动会话」既有逻辑。代价是消费 API/缓存键前须排除哨兵（见 D3，出口唯一且已收敛）。

### D2: create-first 编排放 handleSubmit（mutate 之外），乐观消息零迁移

```
handleSubmit:
  sessionId === DRAFT_SESSION_ID?
    ├─ 是 ─▶ POST /sessions ─▶ setActiveSession(realId)
    │        ─▶ sendMessage({sessionId: realId, content, model?, effort?})   ← 既有路径不动
    │        ─▶ setContent('')（仅在成功入队后）
    │        创建失败 ─▶ alert、留 draft、文本保留
    └─ 否 ─▶ sendMessage({sessionId, ...})                                    ← 原路径不动
```

*备选*：create 塞进 `use-send-message` 的 `mutationFn`。否决——`onMutate` 先于 `mutationFn` 执行且乐观消息 keyed by 调用时的 sessionId（哨兵），要么写进哨兵 key 再迁移缓存、要么重构 onMutate 时序；包装在外让乐观消息直接落在真实 id 下，发送路径一行不改。

create 期间防双击：`busy` 判据追加本地 `creatingDraft` 状态（与 `turnActive`/`sendingHere` 同级），期间输入与按钮禁用——连点不会建出两个会话。

附带修复既有瑕疵：现状 `sendMessage(...); setContent('')` 先清空再异步执行，请求失败文本已丢；新时序仅在成功入队后清空（create 失败与入队前异常都保留文本）。

### D3: 哨兵值与 API/缓存键空间的隔离

draft 唯一的「出口」是 D2 的 handleSubmit（发送前必已替换为真实 id），因此以下键空间永远不会出现哨兵：`turnRuns`、`streamingSegments`、`['messages', ...]` 写入。唯一需要显式排除的是**读取侧**：

- `use-messages.ts`：`enabled: !!sessionId && sessionId !== DRAFT_SESSION_ID`（否则 fetch `GET /sessions/draft/messages` → 404 错态）。draft 态消息区显示空列表。
- 删除会话清理（`useDeleteSession.purgeSession`）等按 id 的逻辑不遇哨兵（draft 行无删除入口）。

### D4: 会话列表合成行 + 「+」禁用

draft 活跃时 `sessions.map` 前插入合成行：图标 + 「新会话」label + 选中态样式，点击 no-op。不复用 `SessionItem`——它绑定重命名/删除/generating 等 per-实体操作，draft 均不适用；内联一个 ~15 行的简化行更干净。「+」在 draft 活跃时 disabled（视觉弱化），避免「重复新建」的歧义（draft 单例）。

### D5: 放弃语义沿现状，不额外处理

切换到其他会话：`setActiveSession(other)` 覆盖哨兵，draft 消失——draft 无任何服务端/缓存状态，零清理。textarea 文本跨会话切换本就保留（既有行为，非 draft 特有）：draft 中输入后切走，文本仍在输入框、落到下一个发送的会话——接受现状，不为本变更引入 per-session 草稿文本。reload 后 draft 消失（ui-store 非持久化）。

### D6: 发送编排的失效覆盖

新会话出现在列表靠既有 `onSettled` 的 `invalidateQueries(['sessions'])`（create 本身无需单独 invalidate——发送 settle 必然触发）。边界：create 成功但发送请求级失败（onError 回滚乐观消息）——此时已 `setActiveSession(realId)`，用户停留在真实空会话，列表失效后可见；重发即可。空会话堆积窗口收窄到该边界，可接受。

## Risks / Trade-offs

- [create 与发送之间断网/失败] → 空会话已建、消息未发：用户停留真实空会话直接重发；较现状（每次点「+」即建）已大幅收窄
- [哨兵值 `'draft'` 与真实 session_id 撞车] → 后端 mint UUID v7，格式前缀完全不同；若仍不放心可换 `'\0draft'` 等不可能形态——当前取可读性
- [draft 输入后切走，文本落入其他会话] → 既有 textarea 跨会话保留行为的延续，不在本变更扩大或修复
- [用户对「+ 立即出现在列表的行」的预期变化] → 合成行同样立即出现（视觉无回退），仅服务端延迟落库——感知差异仅在 reload 后 draft 消失

## Migration Plan

纯前端，发布即生效，无数据迁移；回滚 = 回退前端。存量空会话不受影响（可选：后续手工清理）。

## Open Questions

（无——方案在探索期已与 turn-detach-resume / per-request-model 的落地链路对齐过边界。）
