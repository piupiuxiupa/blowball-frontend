## Why

后端 OpenAPI 1.3.0 已增加用户级持久化定时任务，但前端尚未生成对应类型，也没有创建、管理或查看执行结果的入口。用户目前只能直接调用 REST API，无法在站内使用单次/周期 Agent 任务及追踪其结果。

## What Changes

- 同步生成最新 OpenAPI 类型，并提供定时任务、时间规则、修改请求和运行历史的统一类型导出；任务 CRUD 与历史读取全部归属 API 角色。
- 在应用顶栏增加“定时任务”入口，以管理弹窗提供任务列表、分页、新建、编辑、暂停/恢复和删除能力。
- 支持单次 `at` 与标准五字段 `cron`、显式 IANA 时区、每次创建独立会话或指定既有会话，以及可选模型和思考等级；未选择时沿用后端默认值。
- 展示下次执行时间、启用状态和系统暂停原因；提供运行历史分页，展示计划/实际时间、执行状态、跳过或失败原因及诊断信息。
- 从历史记录打开关联会话，复用现有消息历史、运行中发现与 SSE attach、工具活动、产物和用量展示，不新增第二套执行视图。
- 遵守后端快照与生命周期语义：普通编辑只提交变更字段，启停独立提交；已消费单次任务不会仅因重新启用而重跑；暂停/删除不暗示已启动 Turn 被取消。
- 第一版不提供手动立即运行、自然语言时间解析、前端 cron 下次时间推算、外部通知、自动重试配置或调度器健康状态展示。

## Capabilities

### New Capabilities

- `scheduled-task-management`: 用户级定时任务的站内管理、时间与会话/模型配置、状态及运行历史展示，以及关联会话结果读取。

### Modified Capabilities

无。关联会话继续遵循现有聊天、Turn 生命周期和消息渲染规范，本变更不修改其需求。

## Impact

- **API 契约**：运行 `npm run generate-api` 更新生成文件 `src/lib/openapi.d.ts`；在 `src/lib/api.ts` 增加定时任务相关类型导出，不手改生成文件。
- **数据访问**：新增定时任务 React Query hooks，复用 `apiGet/apiPost/apiPatch/apiDelete`；所有任务管理和历史端点使用 API base，模型目录和会话列表沿用现有 hooks。
- **界面**：修改 `src/components/layout/app-layout.tsx` 增加入口，新增定时任务管理弹窗及必要的小范围表单/格式化辅助代码；复用现有 UI 控件与玻璃风格。
- **会话集成**：历史记录通过 `ui-store.setActiveSession` 打开现有 `ChatPanel`，由既有 `useAttachRun` 发现运行中 Turn；不修改流式协议或持久化消息结构。
- **依赖与状态**：不新增 npm 依赖、路由或 Zustand store；弹窗草稿使用本地 React state，服务端状态由 TanStack Query 管理。
- **验证**：通过现有 Node 测试、TypeScript typecheck 和浏览器流程验证创建、编辑、启停、删除、分页、异常展示及会话跳转。
