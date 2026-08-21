# Tasks: adapt-session-detail

## 1. 契约类型

- [x] 1.1 `src/lib/api.ts` re-export `SessionDetail`（`GET /api/v1/sessions/{session_id}` 响应类型，维持 `paths` 不出 `api.ts` 惯例）

## 2. 发现路径重构

- [x] 2.1 `useAttachRun` 内嵌单会话详情查询：key `['session', activeSessionId]`、`apiGet`（API base）调 `GET /api/v1/sessions/:id`、仅活动会话启用、`refetchOnWindowFocus: true`（豁免理由同 `['sessions']`，不碰文件内容）
- [x] 2.2 attach 判断改双通道：详情已加载以其为准（`generating && run_id`，idle 时压制缓存快路径），未加载走列表缓存先行；保留 `turnRuns[sessionId]` 防重；effect 依赖扩为 `activeSessionId` + 详情数据，聚焦重取驱动的详情变化能触发 attach
- [x] 2.3 更新 `useAttachRun` 既有注释：「仅在会话切换时判断」的双缺口说明改为双通道语义（缓存先行、详情裁决），标注 adapt-session-detail

## 3. 缓存协同

- [x] 3.1 `fallbackToHistory` 失效范围扩为 `['sessions']` + `['session', sessionId]` + 既有 `['messages', sessionId]`
- [x] 3.2 `attachToRun` 终局 `finally` 的 `['sessions']` 失效处同步补 `['session', sessionId]`

## 4. 验证

- [x] 4.1 `npm run lint` 通过
- [x] 4.2 浏览器验证：打开 `generating` 会话即时 attach（快路径）；另一标签页发起生成→切回本页聚焦→查看中会话自动 attach（详情通道）；turn 结束后无重复 attach；410/404 回落后列表与详情缓存均已失效
