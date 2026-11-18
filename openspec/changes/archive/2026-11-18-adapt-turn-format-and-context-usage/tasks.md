## 1. 契约类型同步

- [x] 1.1 运行 `npm run generate-api` 重新生成 `src/lib/openapi.d.ts`，检查生成 diff 包含 `output_format`、context-usage 端点/响应和 done usage 新字段，且不手改生成文件。
- [x] 1.2 在 `src/lib/api.ts` 集中导出当轮格式与 `SessionContextUsageResponse`/可用快照类型；确认发送仍用 agent base、上下文 CRUD 查询用 API base，并运行 `npm run lint` 验证类型接线。

## 2. 当轮产物格式选择

- [x] 2.1 在 `MessageInput` 的模型选择器旁增加独立原生格式 `<select>`，提供自动、HTML、Word、PowerPoint、PDF、Excel、Markdown，使用中文条件性偏好说明，并确保单模型部署下仍显示。
- [x] 2.2 为每次格式选择建立带所属会话的本地选择快照，在 `handleSubmit` 同时捕获快照与 canonical 值；通过 `useSendMessage` variables 将具体值写入 `output_format`，自动模式省略字段，且不修改 `content`、附加上下文或乐观消息。
- [x] 2.3 在 immediate/queued 的提交接受回调中按选择快照身份条件复位为自动；上传、建会话、请求失败不复位，迟到接受不得清除其他会话或后续草稿的新选择。
- [x] 2.4 将 `INVALID_OUTPUT_FORMAT` 纳入现有消息拒绝提示分类；确认 FIFO 仍由服务端恢复格式快照，pending-queue、消息历史和流式分段不新增伪造的格式状态。

## 3. 上下文快照查询与展示

- [x] 3.1 新增 `['context-usage', sessionId]` 查询与共享 `apiGet` queryFn，仅在真实普通会话启用并单独开启聚焦重取；草稿和 scheduled-session 不挂载该查询。
- [x] 3.2 新增聊天头部轻量上下文指示器：`available:true` 时按 `context_tokens / input_budget_tokens` 显示并 clamp 进度，展示服务端剩余量及模型/run/测量时间；`available:false`、无数据或草稿时隐藏数值，不消费 streaming token 或累计 `total_tokens`。
- [x] 3.3 在普通会话删除的既有缓存清理中移除对应 context-usage 查询，确认不影响其他会话缓存。

## 4. 终局有界刷新与回归测试

- [x] 4.1 新增 `tests/context-usage.test.ts` 并加入现有 `npm test` 脚本，用 `fetch` stub 覆盖“第一次旧 run、第二次目标 run 后提前停止”和“持续旧 run/失败最多读取 4 次”两组回归。
- [x] 4.2 实现共享的上下文新鲜读取与 `reconcileContextUsage(sessionId, runId)`：`staleTime:0`、单次 `retry:false`、约 300ms 间隔、目标 `available:true` 且 run id 匹配即停；身份未知只失效一次，耗尽后不构造目标 run 假快照。
- [x] 4.3 在 `runOutput` 的统一终局/回落收尾中异步调用有界刷新，确保历史 reconcile、流式状态清理和后续 run 接管不被阻塞；不为上下文指示增加空闲轮询。

## 5. 验证

- [x] 5.1 运行 `npm run lint`、完整 `npm test` 和 `npm run build`，记录新增回归及既有 35 个 Node 测试的结果。
- [x] 5.2 浏览器验证自动省略字段及六种 canonical 格式值；覆盖立即执行、FIFO queued、草稿首发、上传/请求失败保留，以及延迟接受期间切换会话/更改格式不被旧回调清除。
- [x] 5.3 浏览器验证普通会话打开/聚焦/turn 收尾的用量刷新，检查输入预算分母、零剩余量、`available:false` 和运行中上一轮快照语义；确认草稿与 scheduled-session 没有 context-usage 请求。
- [x] 5.4 运行 `openspec validate adapt-turn-format-and-context-usage` 并审查最终 diff，确认仅包含本变更文件、无新增依赖、无生成类型手改或无关重构。

## 6. 最新契约与实机问题修复

- [x] 6.1 同步新增 `pptx` 契约：重新生成类型，在格式选择器加入 PowerPoint/PPTX，更新映射与别名规格，不接受 `ppt`/`powerpoint`。
- [x] 6.2 先添加会失败的主 Agent 分类回归，再以共享谓词兼容历史 `Confuse` 与当前 `Confucius`；用真实历史会话在 Chrome 验证助手正文稳定可见，子 Agent 仍走触发行。
- [x] 6.3 在真实普通会话返回 `available:false` 时显示“暂无快照”及说明，不展示数值或进度条；用真实 API 验证该状态及可用快照口径。
- [x] 6.4 删除临时调试入口，重新运行 lint、完整测试、生产构建、OpenSpec validate 和 diff 审查，保留未能实机覆盖的验收项并明确记录。
