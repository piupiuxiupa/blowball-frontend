# Tasks: lazy-session-creation

## 1. 哨兵与查询隔离

- [x] 1.1 `ui-store` 导出 `DRAFT_SESSION_ID = 'draft'` 常量（注释说明不变量：哨兵只存在于 `activeSessionId`，不进任何 API 路径与 `turnRuns`/`streamingSegments`/`['messages', ...]` 键空间）
- [x] 1.2 `use-messages.ts` 的 `enabled` 追加 `&& sessionId !== DRAFT_SESSION_ID`，验证 draft 态无 `GET /sessions/draft/messages` 请求

## 2. 列表与面板 UI

- [x] 2.1 `SessionList`：「+」改为 `setActiveSession(DRAFT_SESSION_ID)`（不再 POST）；draft 活跃时「+」禁用
- [x] 2.2 `SessionList`：draft 活跃时在列表顶部渲染合成「新会话」行（选中态、点击 no-op、无重命名/删除入口），对齐 SessionItem 的视觉样式
- [x] 2.3 `ChatPanel`：draft 态消息区空态文案（如「开始新的对话」），区分于未选择会话的文案

## 3. create-first 发送编排

- [x] 3.1 `use-sessions.ts`：`createMutation` 保留但从 `useSessions` 暴露 `createSessionAsync`（供发送编排调用），移除「+」按钮对它的直接触发
- [x] 3.2 `MessageInput`：`handleSubmit` 检测 `activeSessionId === DRAFT_SESSION_ID` → `await` 创建 → `setActiveSession(realId)` → `sendMessage({sessionId: realId, ...})`；本地 `creatingDraft` 状态并入 `busy` 判据（防双击双建）
- [x] 3.3 清空时机：仅在成功入队后 `setContent('')`；创建失败 alert 且保留文本（对照 spec「创建失败保留输入」「入队失败保留输入」）

## 4. 端到端验证

- [x] 4.1 `npm run lint` 通过
- [ ] 4.2 浏览器全流程：「+」建 draft（Network 面板确认零请求）→ 输入并发送 → 会话建立 + 流式回复归属新会话 → 列表出现新会话（标题为后端默认）；draft 中切走即弃；draft 中再点「+」无效果；停后端模拟创建失败 → 文本保留；模型选择器参数随 draft 首条消息生效
