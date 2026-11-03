## 1. 契约与 API 类型

- [ ] 1.1 基于已同步的 openapi.yaml 运行现有 generate-api，核对 SSEQueued、SessionQueueEntry/Response、queued_count、QUEUE_FULL 与 queued 取消状态；保留现有图片及子 Agent 类型，不迁移 staged 上传流程。
- [ ] 1.2 在 API 层补齐队列读取和可观察结果的取消类型/请求，确认 queue GET 走 API base，消息 POST、attach 与 cancel 走 agent base，并保持路径编码和鉴权。

## 2. 提交确认与 run 消费隔离

- [ ] 2.1 抽取可测试的首个有效 SSE 分类及迭代器交接，支持无 agent 的 queued；新提交确认等待后 detach，立即执行时首帧与剩余事件不丢失，active attach 的 queued 重放不触发 detach。
- [ ] 2.2 重构 useSendMessage，使 mutation 只覆盖提交确认，长期执行交由独立生命周期持有；等待确认不登记为 active run，失败不回滚整份历史或清当前流。
- [ ] 2.3 将输出订阅控制器与 Last-Event-ID 绑定固定的 session/run 身份，增加顶层 owner 判据，保留 StreamingSegment 子 Agent runId/agentInstanceId 原义。
- [ ] 2.4 为 reconcile、fallback、finally 和异步错误回调增加 owner 条件清理，确保旧 run 迟到回调不删除新 run 的登记、控制器、游标、产物或分段。

## 3. 队列读模型与执行衔接

- [ ] 3.1 新增按真实会话启用的队列查询 hook，处理 FIFO 快照、run id 去重和临时确认项接管；省略 queued_count 不推断能力关闭，草稿哨兵不请求 queue/detail。
- [ ] 3.2 实现活动会话打开/聚焦、入队/撤回/终局即时刷新及等待/执行阶段有界轮询，空闲后停止，不持续轮询全部隐藏会话；空队列快照不判定 run 终局。
- [ ] 3.3 补齐 active run 身份变化和旧订阅释放后的候选重新判断，自动衔接 FIFO 后续 run，并为探测前已快速结束的 run 重拉历史，避免等待项与用户气泡重复。

## 4. 撤回和停止语义

- [ ] 4.1 新增按队列项 run id 撤回的结果处理：cancelled 确认成功，queued/running/cancelling 刷新并有限次重试或提示，其他终局状态按实际情况收敛，失败保留可重试项且不影响其他 run。
- [ ] 4.2 将输入区停止中状态绑定取消目标 run id，目标终局或 active run 变化时复位；保留取消后部分输出历史收尾，停止当前 run 不清等待队列。

## 5. 输入与待处理展示

- [ ] 5.1 拆分输入区运行状态与提交状态，运行/attach 期间开放正文、模型及附件入口，发送和停止使用独立按钮；保留上传/建会话/提交防重、IME 与上下文选择键盘语义。
- [ ] 5.2 以服务端接受和匹配草稿修订为输入清空边界，保持正文、上下文、图片与模型快照隔离，旧会话请求成功/失败不覆盖新会话草稿，图片预览只在安全匹配时释放。
- [ ] 5.3 新增输入区上方紧凑可折叠的待处理展示，使用现有上下文和图片渲染能力，显示 FIFO 内容预览、模型/入队时间及逐项撤回，不写入历史缓存或导航锚点。
- [ ] 5.4 明确展示 QUEUE_FULL、SESSION_BUSY 兼容和其他请求拒绝原因，保留未接受快照；已接受后的网络问题按订阅恢复，不自动重复 POST。

## 6. 回归与验收

- [ ] 6.1 利用已有 Node/TypeScript 能力建立最小可重复运行的自动化回归入口，优先覆盖抽取的 SSE 分类、队列对齐与 run owner 纯逻辑，不增加生产依赖。
- [ ] 6.2 覆盖立即执行首帧、queued 无 agent、等待连接 detach 不取消、active attach queued 前缀重放、分块 SSE 与续传游标按 run 隔离。
- [ ] 6.3 覆盖旧 run finally/reconcile 迟到、新候选被旧订阅阻挡后恢复、下一轮快速完成历史接管、停止 A 后 B 的停止按钮复位和子 Agent 路由不变。
- [ ] 6.4 覆盖队列 FIFO 去重、空/省略计数、QUEUE_FULL、SESSION_BUSY、撤回与 pump 竞态、请求失败不清当前流、跨会话草稿和已接受消息不重复 POST。
- [ ] 6.5 在浏览器或可控联调环境核对多条连续排队、刷新/切换恢复、队列开/关、逐项撤回及只停止当前 run；回归图片上传、上下文 chips、模型选择、草稿首发和历史导航，并检查等待区域与按钮布局。
- [ ] 6.6 运行自动化回归、现有 lint/build 和 OpenSpec 严格校验，检查生成类型及最终 diff 的改动范围，保留任务开始前已有图片/子 Agent 改动和未跟踪配置文件。
