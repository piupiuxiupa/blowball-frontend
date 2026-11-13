# scheduled-task-management

## Purpose

定义用户自有的定时 Agent 任务（at/cron）管理能力：类型化 API 接入与 base 路由、任务列表与生命周期（创建/编辑/暂停/恢复/删除）、执行历史呈现与取消、按会话来源（scheduled/legacy_interactive）分流的执行结果查看，以及 .cron 任务资源草稿与发布版本管理。


### Requirement: Typed scheduled-task API access

前端 SHALL 从当前 `openapi.yaml` 生成定时任务类型，并 SHALL 通过 `src/lib/api.ts` 的统一导出消费任务、时间规则、修改请求和运行历史类型。所有任务 CRUD 与运行历史请求 SHALL 使用 API base 和既有 JWT 请求封装，MUST NOT 因执行结果读取而改走 Agent base。

#### Scenario: Use task management in a split deployment
- **WHEN** API base 与 Agent base 不同，用户打开任务列表或提交任务修改
- **THEN** 请求发送到 API base 的 `/api/v1/scheduled-tasks` 对应资源并携带现有鉴权头
- **AND** 不产生任务管理请求到 Agent base

#### Scenario: Regenerate rather than hand-edit contract types
- **WHEN** 实施者同步本次 OpenAPI 契约
- **THEN** `src/lib/openapi.d.ts` 由既有生成命令更新
- **AND** 应用代码从 `src/lib/api.ts` 获取定时任务类型而不是另行手写重复 DTO

### Requirement: Scheduled-task management entry and list

应用顶栏 SHALL 提供“定时任务”入口。任务弹窗 SHALL 展示任务名称、时间规则、启用状态、可用的下次执行时间和会话策略，并 SHALL 提供新建、编辑、暂停/恢复、删除和查看运行历史操作。列表 SHALL 具有加载、空、失败及重试状态。

#### Scenario: Open an empty task list
- **WHEN** 已登录用户打开定时任务弹窗且没有未删除任务
- **THEN** 前端显示空状态和可用的新建入口
- **AND** 不把空列表显示为请求失败

#### Scenario: Recover from a list failure
- **WHEN** 任务列表请求失败
- **THEN** 弹窗显示错误和重试入口
- **AND** 用户无需退出整个工作区即可重新加载

#### Scenario: Paginate without a total count
- **WHEN** 用户浏览任务列表且响应只包含 tasks/limit/offset
- **THEN** 前端按服务端 limit/offset 翻页，仅在当前页可能仍有后续数据时提供下一页
- **AND** 不显示虚构的总条数或总页数

### Requirement: One-shot task creation

前端 SHALL 支持使用原生日期时间输入创建 `at` 任务，并 SHALL 显示输入所采用的浏览器 IANA 时区。提交 SHALL 包含晚于当前时间、带显式偏移的 RFC3339 `run_at` 及该 `timezone`。创建请求 SHALL 包含非空 name/prompt，省略会话策略和 enabled 时 SHALL 保持后端默认的新会话与启用语义。

#### Scenario: Create a future one-shot task
- **WHEN** 用户填写名称、指令和未来的浏览器本地执行时间并提交
- **THEN** 前端将时间转换为带显式偏移的 RFC3339 `run_at`，同时提交浏览器 IANA timezone
- **AND** 创建成功后刷新任务列表并显示后端返回的 next_run_at

#### Scenario: Reject an empty or past one-shot input
- **WHEN** 名称、指令或执行时间为空，或输入时间不晚于当前时间
- **THEN** 前端阻止提交并标识需要修正的字段
- **AND** 不发送创建请求

### Requirement: Cron task creation and timezone handling

前端 SHALL 支持标准五字段 `cron` 和显式 IANA timezone，timezone SHALL 默认采用浏览器时区且允许编辑。前端 SHALL 做非空与五字段数量校验，但 MUST NOT 以前端解析结果替代后端语法、时区或下次槽位计算。

#### Scenario: Create a cron task
- **WHEN** 用户提交合法五字段表达式、IANA 时区和必填文本
- **THEN** 前端提交结构化 `{type: cron, expression, timezone}`
- **AND** 界面展示后端返回的 next_run_at 而不是自行推算的槽位

#### Scenario: Reject a malformed field count
- **WHEN** cron 表达式按空白拆分后不是五个字段
- **THEN** 前端阻止提交并保留其他表单草稿

#### Scenario: Preserve a draft after server schedule validation fails
- **WHEN** 后端因 cron 语法、宏、时区或其他计划规则返回 400
- **THEN** 弹窗显示请求错误且用户输入不丢失
- **AND** 用户可修改后重新提交

### Requirement: Session and model configuration

任务创建 SHALL 固定采用每次独立会话模式（`{mode: new}`），MUST NOT 提供已退役的既有会话（existing）选择。存量 existing 任务 SHALL 仅在编辑中提供迁移到 new 的入口，迁移 PATCH 只包含 `{mode: new}`；迁移前后 MUST NOT 提交 session_id。

模型和思考等级 SHALL 使用现有模型目录但保存在任务草稿中，MUST NOT 修改聊天输入区的全局模型选择。创建时缺省选择 SHALL 省略对应字段；非 thinking 模型 MUST NOT 提交非 `none` 的显式 effort。

#### Scenario: Create with independent sessions only
- **WHEN** 用户创建任务并提交
- **THEN** 请求的 session 固定为 `{mode: new}`
- **AND** 不渲染既有会话选择器或目标会话输入

#### Scenario: Migrate a legacy existing task
- **WHEN** 存量 existing 任务因 SESSION_POLICY_MIGRATION_REQUIRED 暂停，用户在编辑中切换为每次独立会话并保存
- **THEN** PATCH 只包含 `{session: {mode: new}}`
- **AND** 界面说明任务需迁移后才恢复执行且不提交任何 session_id

#### Scenario: Keep deployment defaults on creation
- **WHEN** 创建任务时模型或思考等级选择“默认”
- **THEN** 对应字段在创建请求中省略
- **AND** 聊天输入区当前模型选择保持不变

#### Scenario: Avoid an unsupported default-reset patch
- **WHEN** 编辑已有显式 model 或 reasoning_effort 的任务
- **THEN** 前端不提供当前 PATCH 契约无法实现的“清除并恢复默认”操作
- **AND** 用户可保留原值或改为另一个合法显式值

### Requirement: Partial edits and consumed one-shot schedules

普通编辑 SHALL 以进入编辑时的任务为基准，仅提交实际变化的字段；未变化的 schedule MUST NOT 随其他字段回传。后台刷新 MUST NOT 覆盖正在编辑的本地草稿。已消费 `at` SHALL 显示为不再排期，只有显式提交新的未来 `run_at` 才能重新安排。

#### Scenario: Rename a consumed one-shot task
- **WHEN** 已消费单次任务没有 next_run_at，用户只修改名称并保存
- **THEN** PATCH 只包含名称等实际变化字段且不包含旧 schedule
- **AND** 前端不错误显示任务已重新安排

#### Scenario: Reschedule a consumed one-shot task
- **WHEN** 用户为已消费单次任务显式输入新的未来执行时间并保存
- **THEN** PATCH 包含新的未来 run_at 和时区
- **AND** 界面采用响应中的新 next_run_at

#### Scenario: Refresh while editing
- **WHEN** 用户正在修改指令且任务列表后台刷新返回不同快照
- **THEN** 当前草稿保持用户输入
- **AND** 列表快照更新不触发表单重置

### Requirement: Pause resume and delete lifecycle semantics

暂停和恢复 SHALL 通过独立的 `{enabled}` PATCH 完成，MUST NOT 附带整张编辑表单。删除 SHALL 经用户确认后调用软删除端点。界面 SHALL 明确暂停或删除不会自动取消已跨过启动 fence 的 Turn，并 SHALL 采用服务端响应刷新状态而不是本地猜测 next_run_at 或 paused_reason。

#### Scenario: Resume a paused cron task
- **WHEN** 用户恢复已暂停的 cron 任务
- **THEN** 前端只提交 `{enabled: true}`
- **AND** 展示服务端计算的下一槽位，不补算暂停期间的槽位

#### Scenario: Delete a task with a running occurrence
- **WHEN** 用户确认删除具有运行中 occurrence 的任务
- **THEN** 确认文案说明已启动执行不会自动停止
- **AND** 删除请求成功后任务从管理列表消失且运行历史不被前端宣称已删除

#### Scenario: Mutation fails
- **WHEN** 启停或删除请求失败
- **THEN** 前端显示错误并保留可重试的当前任务视图
- **AND** 不把未确认的状态变化呈现为成功

### Requirement: Task status and paused-reason presentation

任务状态 SHALL 区分启用、用户暂停和系统原因暂停，并 SHALL 覆盖契约中的 `TASK_PAUSED`、`USER_UNAVAILABLE`、`SESSION_UNAVAILABLE`、`TASK_DELETED`、`SESSION_POLICY_MIGRATION_REQUIRED` 原因；服务端执行挂起（blocked_reason）SHALL 原样呈现。next_run_at SHALL 按用户可读的本地时间显示；其缺失 MUST NOT 被统一解释为执行成功。

#### Scenario: Show an unavailable target session
- **WHEN** 任务 enabled=false 且 paused_reason=SESSION_UNAVAILABLE
- **THEN** 列表显示目标会话不可用导致的暂停原因
- **AND** 不只显示笼统的“已暂停”

#### Scenario: Show a consumed one-shot schedule
- **WHEN** 单次任务已消费且 next_run_at 缺失
- **THEN** 界面显示单次排期已消费或不再排期
- **AND** 不据此宣称 occurrence 已成功

### Requirement: Durable run-history presentation and refresh

任务运行历史 SHALL 支持 limit/offset 分页，展示 scheduled_for、status、可用的 reason/error、开始/结束时间和关联会话。界面 SHALL 覆盖 pending、preparing、launching、running、succeeded、error、skipped、cancelled、interrupted 及契约定义的全部 reason（含 `TASK_EXECUTION_UNCERTAIN`、`RESULT_PERSIST_FAILED`、`SESSION_POLICY_MIGRATION_REQUIRED`），不得把 skipped/interrupted 归为成功。非终态 occurrence SHALL 提供取消操作，调用任务会话的专用取消端点；受理成功 MUST NOT 被呈现为终局，终局状态仍由历史轮询呈现。

弹窗打开期间 SHALL 以有界方式刷新任务状态；历史含非终态 occurrence 时 SHALL 轮询，全部终局、离开历史视图或关闭弹窗后 SHALL 停止历史轮询。

#### Scenario: Show a skipped occurrence
- **WHEN** 历史项 status=skipped 且 reason=SESSION_BUSY 或 TASK_OVERLAP
- **THEN** 前端显示对应的跳过原因和计划时间
- **AND** 不显示为执行成功或提供伪造的消息结果

#### Scenario: Follow an active occurrence
- **WHEN** 历史页包含 pending、preparing、launching 或 running 项
- **THEN** 前端以有界间隔刷新该任务历史
- **AND** 所有可见记录终局后停止该历史轮询

#### Scenario: Cancel a running occurrence
- **WHEN** 用户对非终态历史项发起取消
- **THEN** 请求走 Agent base：任务会话调用 `/api/v1/scheduled-sessions/{session_id}/runs/{run_id}/cancel`，legacy_interactive 的 run 调用普通会话取消路径
- **AND** 界面仅呈现受理回执并继续由历史轮询呈现终局，不把受理显示为已取消

#### Scenario: Close the management dialog
- **WHEN** 用户关闭定时任务弹窗或卸载管理视图
- **THEN** 任务与历史查询不再保持弹窗轮询
- **AND** 不遗留未清理的定时器或异步状态写入

### Requirement: Occurrence result viewing per session provenance

历史项的会话入口 SHALL 按 `session_source` 分流：`legacy_interactive` 的存量 occurrence SHALL 沿用现有聊天跳转（失效会话列表、关闭弹窗并设置 activeSessionId）；其余 SHALL 在管理弹窗内以只读视图读取 `/api/v1/scheduled-sessions/{session_id}/messages` 并复用既有持久化消息分组与渲染组件，MUST NOT 新建流式管线或发送入口。运行中 occurrence 打开的消息视图 SHALL 以有界间隔刷新。`content_deleted=true` 的历史项 MUST NOT 提供内容入口且 SHALL 标注内容已删除。

#### Scenario: Open a scheduled occurrence transcript
- **WHEN** 用户打开 session_source=scheduled 历史项的会话
- **THEN** 弹窗内只读视图按既有分组渲染该会话的持久化消息、工具活动和产物
- **AND** 不关闭弹窗、不设置 activeSessionId、不创建任务专属流式订阅

#### Scenario: Open a legacy interactive occurrence
- **WHEN** 用户打开 session_source=legacy_interactive 历史项的会话
- **THEN** 前端沿用现有聊天跳转与消息查询
- **AND** 不把该会话误路由到 scheduled-sessions 端点

#### Scenario: Deleted task-session content
- **WHEN** 历史项 content_deleted=true
- **THEN** 前端保留执行事实并标注内容已删除，不提供会话入口
- **AND** 不伪造消息内容或删除 occurrence 记录

### Requirement: Task resource drafts and published versions

任务 SHALL 提供资源视图：读取 `.cron` 草稿文件与已发布版本元数据，展示当前绑定。发布 SHALL 调用幂等发布端点并携带草稿 CAS 栅栏（expected_draft_revision），同一次发布意图的重试 MUST 复用同一 request_id；发布成功后 SHALL 以 PATCH 绑定新版本（resource_revision + manifest_hash + expected_revision）。已发布版本 SHALL 可独立绑定或解绑（resource_revision=0），界面 MUST NOT 提供草稿文件的在线编辑（草稿经由工作区文件面板维护）。

#### Scenario: Publish and bind the draft
- **WHEN** 用户在资源视图点击发布且草稿非空
- **THEN** 发布请求携带当前 draft_revision 与本次意图的 request_id，成功后任务绑定新版本
- **AND** 失败重试复用同一 request_id 而不重复发布

#### Scenario: Publish with an empty draft
- **WHEN** 草稿没有任何文件
- **THEN** 发布入口不可用并提示先在文件面板添加草稿
- **AND** 不发送发布请求

#### Scenario: Rebind or clear the binding
- **WHEN** 用户绑定既有版本或清除绑定
- **THEN** PATCH 分别携带该版本的 manifest_hash 或 resource_revision=0
- **AND** 界面采用服务端返回的绑定状态，不本地推演

### Requirement: Dialog operation safety and accessibility

管理弹窗 SHALL 提供可访问名称、表单标签、明确关闭按钮和 Escape 关闭。异步提交期间 SHALL 防止相同操作重复提交，加载、空态和错误 SHALL 位于相应视图中；mutation rejection SHALL 被界面处理。

#### Scenario: Submit a form repeatedly
- **WHEN** 创建或保存请求仍在进行，用户再次触发提交
- **THEN** 相同请求不会因重复点击而并发发送
- **AND** pending 状态在界面可见

#### Scenario: Close with keyboard
- **WHEN** 管理弹窗打开且用户按下 Escape
- **THEN** 弹窗按现有弹窗模式关闭
- **AND** 未提交草稿不被静默写成服务端变更
