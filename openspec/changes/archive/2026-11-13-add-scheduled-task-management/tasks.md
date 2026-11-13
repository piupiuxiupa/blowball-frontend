## 1. API 契约与纯逻辑

- [x] 1.1 运行 `npm run generate-api` 同步 `src/lib/openapi.d.ts`，确认定时任务 CRUD、运行历史及所有枚举均已生成，且不手改生成文件。
- [x] 1.2 在 `src/lib/api.ts` 增加 `ScheduleRule`、`ScheduledTask`、创建/修改请求、任务/历史列表及 occurrence 类型导出，保持应用侧统一从该模块取类型。
- [x] 1.3 增加小范围定时任务辅助逻辑：浏览器时区与 `at` 输入转换、cron 基础校验、分页边界、非终态判断、状态/原因文案和 dirty PATCH 构造；不写 cron 下次槽位计算器。
- [x] 1.4 增加现有 Node test runner 可执行的 `tests/scheduled-task*.test.ts` 并接入 `npm test`，至少覆盖未来/过去单次时间、五字段校验、仅改名称时不回传旧 schedule、独立 enabled patch、非终态与分页边界。

## 2. React Query 数据层

- [x] 2.1 新增 `src/hooks/use-scheduled-tasks.ts`，通过 `apiGet/apiPost/apiPatch/apiDelete` 实现任务列表和运行历史分页查询；查询 key 包含 offset/taskId，所有请求固定走 API base。
- [x] 2.2 实现创建、dirty 编辑、独立启停和删除 mutations，成功后按前缀失效相关任务/历史缓存；失败向上返回可见错误，不在本地伪造 next_run_at 或执行状态。
- [x] 2.3 将查询启用条件绑定弹窗和当前视图，实现打开期间任务状态刷新、非终态历史轮询及终局/关闭后的停止逻辑，避免卸载后的定时器或状态写入。

## 3. 管理弹窗与任务列表

- [x] 3.1 新增 `src/components/settings/scheduled-tasks-dialog.tsx` 的弹窗骨架，并在 `AppLayout` 顶栏增加“定时任务”入口；用局部 state 管理列表/新建/编辑/历史视图，不新增路由或 Zustand store。
- [x] 3.2 按现有玻璃风格实现弹窗标题、关联 label、关闭按钮、Escape、loading/empty/error/retry 和 mutation pending/防重复提交行为。
- [x] 3.3 实现任务列表与原生 limit/offset 翻页，展示名称、at/cron 规则、会话策略、本地化 next_run_at、启用状态及完整 paused_reason 文案；正确区分单次排期已消费与执行成功。
- [x] 3.4 接入列表的新建、编辑、启停、历史入口和删除确认；启停只发送 `{enabled}`，暂停/删除文案明确已开始 Turn 不会自动停止，失败时保留可重试视图。

## 4. 新建与编辑表单

- [x] 4.1 实现名称、指令和 at/cron 表单：at 使用带浏览器时区说明的 `datetime-local`，cron 使用五字段表达式和可编辑 IANA timezone；前后端校验失败均保留草稿。
- [x] 4.2 实现新会话/既有会话策略及当前用户会话选择，切回 new 时不携带旧 session_id，并说明 existing 会话忙时可能 SESSION_BUSY 跳过。
- [x] 4.3 复用 `useModels` 实现任务局部模型/思考等级选择、缺省字段省略及 thinking 门控，不写聊天全局模型状态；已有显式值时不提供契约不支持的“恢复默认”PATCH。
- [x] 4.4 将编辑草稿初始化与服务器快照刷新解耦，保存时只提交变化字段；覆盖已消费 at 的普通编辑和显式未来时间重排，成功后采用服务端响应并返回列表。

## 5. 运行历史与结果跳转

- [x] 5.1 实现运行历史列表、加载/空/错误状态和 limit/offset 翻页，展示计划/开始/结束时间、所有 status/reason、可用的 error 与尝试信息，不把 skipped/interrupted 显示为成功。
- [x] 5.2 实现“查看会话”：失效会话列表、关闭弹窗并调用 `setActiveSession(session_id)`，复用现有消息历史与 `useAttachRun`；不新增任务专属 SSE 或消息渲染，已删除会话沿用现有读取错误。

## 6. 验证

- [x] 6.1 运行 `npm test`、`npm run lint` 和 `npm run build`，修复所有回归与类型错误，并检查最终 diff 不包含手工生成的契约类型或无关依赖。
- [x] 6.2 启动前端在浏览器完整验证：at/cron 创建、服务端 400 后草稿保留、编辑中后台刷新、启停、删除、两类分页、活动历史轮询停止、已完成/运行中/不可读会话跳转及 Escape/重复提交。
- [x] 6.3 在可用时以不同 `VITE_API_BASE_URL`/`VITE_AGENT_BASE_URL` 验证任务 CRUD 和历史仅请求 API base，而运行中会话仍由现有 Agent 流式链路接管。

## 7. 契约同步（1.3.0：任务会话分离与 .cron 资源）

- [x] 7.1 重新运行 `npm run generate-api`，在 `src/lib/api.ts` 导出 scheduled-sessions（历史读/取消）、任务资源（读取/发布）与 ScheduledSession 相关类型。
- [x] 7.2 会话策略退役同步：创建固定 `{mode: new}`，仅存量 existing 任务在编辑中提供迁移；补齐 SESSION_POLICY_MIGRATION_REQUIRED 等新枚举文案。
- [x] 7.3 “查看会话”按 session_source 分流：legacy_interactive 沿用聊天跳转，其余在弹窗内复用 groupMessages/ChatMessage 只读渲染 scheduled-sessions 消息，content_deleted 禁用入口；非终态 occurrence 提供取消。
- [x] 7.4 新增任务资源视图：草稿文件/版本元数据、幂等发布（request_id 复用 + draft CAS）、发布后绑定与解绑。
- [x] 7.5 `npm test`、`tsc -b`、`npm run build` 全绿，新增迁移/绑定/分流纯逻辑测试。
