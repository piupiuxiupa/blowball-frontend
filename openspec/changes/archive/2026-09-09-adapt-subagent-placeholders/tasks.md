# Tasks: adapt-subagent-placeholders

## 1. 契约同步

- [x] 1.1 `npm run generate-api` 重新生成 `src/lib/openapi.d.ts`（messages GET 新增 `subagent_content` 参数与 `INVALID_SUBAGENT_CONTENT` 400）

## 2. 历史拉取切到 placeholder 视图

- [x] 2.1 `use-messages` 分页循环统一携带 `subagent_content: 'placeholder'`，注释说明与 runs 接口的职责划分
- [x] 2.2 核对 `['messages', sessionId]` 键空间全部消费方（onMutate 乐观消息 / onError 回滚 / onSettled 失效 / reconcile 计数 / attach 回落 / 会话删除 purge），确认键不变、语义不退化

## 3. 点击气泡懒加载子 Agent 内容

- [x] 3.1 `sub-agent-run-transcripts.tsx` 重构：`SubAgentRunTranscripts` 唯一 run 时直出展开的 transcript（无头部/无需再点），多 run 时按时间倒序逐条展开；`RunTranscript` 抽出（`initialExpanded`），修复全局面板展开态被 reverse 错位/覆盖的问题
- [x] 3.2 `CollapsibleSubAgent` 新增 `runHistory` prop：持久化块展开时挂载懒加载面板；流式段（`runHistory=false`）不挂——段即实时输出，进行中的 run 无终态行
- [x] 3.3 `AgentMessage` 透传 `runHistory`（缺省 true），`message-list` 流式分支显式传 false
- [x] 3.4 `groupMessages` 收尾：孤立 `agent_error` 块归并进同实例线程块（面板唯一挂载点）

## 4. turn 收尾联动

- [x] 4.1 `reconcileTurnHistory` 清空分段后失效 `['subagent-runs', sessionId]`，使本 turn 子 Agent 的终态 run 立即可被展开查看（不等 staleTime 过期）

## 5. 展开态抗虚拟列表卸载

- [x] 5.1 持久化子 Agent 气泡的折叠态提升进 ui-store（`expandedSubAgentBlocks[sessionId][blockId]`，blockId = `agent-<行 id>` 稳定键）；流式段保持组件本地态
- [x] 5.2 `npm run lint`（tsc）通过

## 6. 验证

- [x] 6.1 浏览器验证：含子 Agent 的历史会话——气泡折叠态无内容泄漏；点击展开后经 runs 接口展示该实例内容（单 run 直出、多 run 列表）；resume 实例跨 turn 单面板；发送含子 Agent 的回合，reconcile 后展开气泡能立即看到刚结束的 run
- [x] 6.2 浏览器验证：展开子 Agent 气泡 → 向下滚动使其卸载 → 滚回，气泡仍展开且明细在（React Query 缓存命中，无重复请求）
