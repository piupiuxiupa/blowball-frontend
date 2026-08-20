# Proposal: lazy-session-creation

## Why

点击「新建会话」立即 `POST /api/v1/sessions` 落一行服务端会话——用户随即放弃输入（点别处、直接关页）时，后端堆积空会话：垃圾数据、列表噪音、无谓请求。改为 **draft 模式**：点击仅在前端建立草稿会话，真实创建推迟到用户发出第一条消息时（经典 ChatGPT 交互），空会话的堆积窗口从「每次点击」收窄到「创建后、发送前失败」的罕见边界。

## What Changes

- **前端 draft 哨兵**：`activeSessionId = DRAFT_SESSION_ID`（`'draft'` 常量）表示未落库的新会话；「+」按钮不再发起点创建请求，仅切换到 draft 态。
- **会话列表**：draft 活跃时顶部合成「新会话」行（选中态、无重命名/删除入口——无服务端实体）；draft 活跃时「+」禁用（单 draft）。
- **消息区**：draft 会话不发起源史查询（`use-messages` 的 `enabled` 排除哨兵值，否则 `GET /sessions/draft/messages` 404），显示空态即可输入。
- **create-first 发送编排**：draft 中发送 = 先 `POST /sessions` 取真实 id → `setActiveSession(real)` → 以真实 id 走既有 `sendMessage`（乐观消息直接落在真实 id 的缓存下，零迁移）。
- **失败语义**：创建失败 → 留在 draft、输入文本保留、提示错误；仅在成功入队后才清空输入框（顺带修复现状「先清空输入再异步 mutate，失败后文本已丢」的既有瑕疵）。
- **放弃语义**：切换到其他会话 = 静默弃 draft（无持久化物，无需确认）；draft 不持久化，reload 后自然消失。

## Capabilities

### New Capabilities

- `session-draft-creation`：draft 会话的生命周期——纯前端建立与列表合成行、首条消息触发的真实创建编排（含失败保留）、消息区空态与查询隔离、切换放弃与非持久化。

### Modified Capabilities

（无——前端无既有会话管理 spec；`chat-turn-lifecycle` 不受影响：新会话不可能有运行中 turn，draft 不进 `turnRuns`/`streamingSegments` 的键空间。）

## Impact

- **代码**：`src/stores/ui-store.ts`（哨兵常量）、`src/hooks/use-messages.ts`（`enabled` 排除哨兵）、`src/components/sessions/session-list.tsx`（合成行、「+」禁用）、`src/hooks/use-sessions.ts`（createMutation 改由发送编排调用）、`src/components/chat/message-input.tsx`（create-first 编排、清空时机）、`src/components/layout/chat-panel.tsx`（空态文案）。
- **契约**：无变更（`POST /sessions` 原样使用）。
- **行为**：与 turn-detach-resume / per-request-model 的已落地发送链路正交——create-first 在流式发送之前完成，模型选择参数随首条消息正常生效。
