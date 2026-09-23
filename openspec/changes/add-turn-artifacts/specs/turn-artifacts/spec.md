# turn-artifacts

## ADDED Requirements

### Requirement: blowball:// 产物链接渲染与点击拦截

markdown 渲染器 SHALL 将 `blowball://workspace/<path>` 形式的链接渲染为可点击元素（保留 href 语义用于展示），并在点击时拦截默认跳转、进入统一的「打开产物」动作。`<path>` 在打开前 SHALL 做 URL decode（路径可含中文与空格）。普通 http/https 链接的渲染与新窗口打开行为 SHALL NOT 改变。agent 未使用链接语法的裸路径文本 SHALL NOT 被 linkify。

#### Scenario: 产物链接可点击且不离开应用
- **WHEN** 消息中包含 `[季度报告.docx](blowball://workspace/reports/%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A.docx)` 链接且用户点击
- **THEN** 不发生浏览器跳转，系统以 decode 后的路径 `reports/季度报告.docx` 进入「打开产物」动作

#### Scenario: 普通外链行为不变
- **WHEN** 消息中包含普通 `https://` 链接
- **THEN** 链接照常渲染并在新窗口打开（与既有行为一致）

#### Scenario: 裸路径不 linkify
- **WHEN** 消息中出现未包裹为 markdown 链接的工作区相对路径文本
- **THEN** 该文本按普通段落渲染，不产生可点击元素

### Requirement: 产物条按 turn 聚合渲染

系统 SHALL 将每个 turn 的产物渲染为该 turn 最后一条 assistant 消息下方的 chip 行（每条产物一个 chip：文件图标、文件名、大小）。实时流的产物数据源 SHALL 为 `done` 事件的 `meta.artifacts` 摘要；历史消息的产物列表 SHALL 从持久化的 `artifact` 事件行（`event_type="artifact"`，content 为 ArtifactInfo JSON）重建，SHALL NOT 依赖 `done`（其不持久化）。按 path 去重。turn 无产物时 SHALL NOT 渲染产物条。

#### Scenario: 实时流结束后出现产物条
- **WHEN** 流式 turn 的 `done` 事件 `meta.artifacts` 含 2 条产物
- **THEN** 该 turn 回复下方渲染 2 个 chip，历史重拉取接管后产物条保持可见且不重复

#### Scenario: 刷新后历史消息还原产物条
- **WHEN** 用户刷新页面并重新加载包含 artifact 事件行的会话历史
- **THEN** 对应 turn 的最后一条 assistant 消息下方渲染相同的产物条

#### Scenario: 无产物的 turn 不渲染
- **WHEN** 一个 turn 的 `done.meta.artifacts` 为空数组，且历史中无 artifact 行
- **THEN** 不渲染产物条区域

#### Scenario: 重放去重
- **WHEN** SSE 断线重连导致同一 artifact 信息重复出现
- **THEN** 产物条按 path 去重，每个产物仅渲染一个 chip

### Requirement: 点击时版本钉定

「打开产物」动作 SHALL 在**点击时**按以下顺序解析目标版本：先在点击来源消息所属 turn 的 artifact 列表中按 path 查找，命中则用其 `version_id`；未命中则请求 `GET /api/v1/workspace/versions/resolve?path=<path>&before=<来源消息时间>`，200 用返回的 `version_id`，404 或请求失败则按"当前版本"处理。解析结果 SHALL 按 `(path, before)` 缓存。链接的渲染输出 SHALL NOT 携带版本信息，解析失败 SHALL NOT 阻断点击。

#### Scenario: 本 turn 产物钉到本 turn 版本
- **WHEN** 用户点击 turn N 消息中的链接，且该 turn 的 artifact 列表含同 path 条目
- **THEN** 系统以该条目的 `version_id` 打开历史版本，即使文件已被后续 turn 覆盖

#### Scenario: 跨 turn 引用按消息时间解析
- **WHEN** 用户点击 turn N 消息中引用 turn N-2 产物（本 turn artifact 列表无此 path）的链接
- **THEN** 系统以该消息时间作为 `before` 调用 resolve，并用返回的 `version_id` 打开

#### Scenario: 解析失败降级为当前版本
- **WHEN** resolve 返回 404 或请求失败
- **THEN** 系统打开该 path 的当前工作区版本，不展示错误、不阻断动作

### Requirement: 按文件类型的打开路由

「打开产物」动作 SHALL 按扩展名路由：Office（doc/docx/xls/xlsx/ppt/pptx）默认以 OnlyOffice **view** 配置预览（当前版本用 `onlyoffice-config` 响应的 `view` 配置；历史版本用既有 `GET /api/v1/workspace/files/{path}/onlyoffice-version-config?versionId=`——版本库由 office-vers 背书，version_id 同空间）；PDF 与图片内联预览；文本/代码/Markdown/csv 进应用内只读查看器；其余类型触发下载。历史版本经既有版本预览通道打开（office-vers 同空间，`useOfficeVersionConfig`/`useVersionBlob` 直接复用）。产物条目缺少 `version_id`（未快照）时 SHALL 打开当前版本。

#### Scenario: docx 默认预览而非编辑
- **WHEN** 用户点击指向 docx 产物的链接或 chip
- **THEN** OnlyOffice 以 view 模式打开（当前版本用响应中的 view 配置），不出现编辑界面

#### Scenario: 历史 docx 打开版本快照
- **WHEN** 用户点击带 `version_id` 的 docx 产物
- **THEN** 系统经版本 onlyoffice-config 初始化 OnlyOffice，展示该版本的只读内容

#### Scenario: 未快照产物打开当前版本
- **WHEN** 产物条目中无 `version_id`
- **THEN** 系统按"当前版本"路径打开该文件

### Requirement: 产物打开与工作区共用同一套面板

点击产物链接/chip SHALL 与点击工作区文件树走同一条路径（`selectFile` 族）：中部面板呈现完整文件视图（含文件工具条），文件树选中态同步。有 `version_id` 时 SHALL 额外钉到该历史版本（现有版本预览：FileToolbar + 只读预览 + 可恢复）。打开动作与工作区文件点击同样受未保存改动（dirty）拦截约束，拦截确认后钉版 SHALL NOT 丢失。

#### Scenario: 产物点击呈现完整面板
- **WHEN** 用户点击指向当前版本的产物链接
- **THEN** 中部面板以与工作区文件点击完全一致的方式打开该文件（工具条、编辑入口、文件树选中同步）

#### Scenario: 历史版本钉版与 dirty 拦截
- **WHEN** 当前活动文件有未保存改动，用户点击带 `version_id` 的产物 chip
- **THEN** 弹出 dirty 拦截；用户选择保存/不保存完成切换后，内容区钉到该历史版本预览

#### Scenario: 历史版本预览能力与版本历史抽屉一致
- **WHEN** 产物历史版本预览处于打开状态
- **THEN** 面板行为与版本历史抽屉打开的预览一致（只读 + 「恢复此版本」+ 退出预览）

### Requirement: 错误与降级处理

系统 SHALL 对打开动作的失败做降级：文件或版本 404 时提示"文件不存在或已被删除"；onlyoffice-config 503（未配置 OnlyOffice）时复用既有版本预览的回退（docx/xlsx 轻量查看器，无解析器的类型给下载入口）；其余网络错误 SHALL NOT 使消息区或文件面板进入不可用状态。

#### Scenario: 已删除文件的链接
- **WHEN** 用户点击指向已删除文件的链接或 chip
- **THEN** 系统提示"文件不存在或已被删除"，界面其余功能不受影响

#### Scenario: OnlyOffice 未配置时回退
- **WHEN** Office 产物的 config 接口返回 503
- **THEN** 历史版本复用既有版本预览回退（docx/xlsx 轻量查看器，无解析器的类型给下载入口），当前版本可下载，不展示 OnlyOffice 错误页
