# file-versioning

## Purpose

定义工作区文件的「按需版本管理」能力：前端经 office-vers 客户端模块（base URL 取 `VITE_OFFICE_VERS_BASE_URL`）**直连** office-vers，并以登录用户的 `user_id` 作为 `{uuid}` 命名空间（首版无鉴权）。用户可手动将当前已落盘的工作文件记录为新版本（不自动记录），在编辑器右侧的版本历史抽屉按活动文件浏览历史版本、只读预览任意历史版本（复用现有查看器，不落盘），并可把指定版本内容恢复回工作区工作文件（恢复不在 office-vers 新建版本）。

## Requirements

### Requirement: 用户可手动将当前文件记录为版本
系统 SHALL 在文件工具条提供「记录版本」入口，对任意类型文件把当前**已落盘**的工作文件内容作为新版本上传至 office-vers（`POST /documents/{uuid}/{filepath}`）。office-vers SHALL NOT 自动记录版本——版本仅由用户显式触发产生。

#### Scenario: 记录版本成功
- **WHEN** 用户在已保存的文件上点击「记录版本」
- **THEN** 系统取当前工作文件已落盘内容并上传至 office-vers，成功后提示已记录，并在版本历史（若已展开）中体现新版本

#### Scenario: 文本文件有未保存改动时拦截
- **WHEN** 当前文本文件存在未保存改动（dirty）时用户点击「记录版本」
- **THEN** 系统**不**发起上传，并提示「当前有未保存改动，请先保存后再记录版本」

#### Scenario: Office 文件直接快照已落盘内容
- **WHEN** 当前文件为 Office 类型时用户点击「记录版本」
- **THEN** 系统不判定 dirty，直接快照工作区最后一次落盘（OnlyOffice forcesave）的内容

#### Scenario: 未登录时不提供版本入口
- **WHEN** 用户未登录（无 `user_id`）
- **THEN** 系统不展示「记录版本」入口

### Requirement: 版本历史抽屉按活动文件展示
系统 SHALL 在编辑器右侧提供可折叠的版本历史抽屉，按当前活动文件的逻辑路径从 office-vers 拉取版本列表（`GET ?action=versions`）并呈现（含时间、大小、是否最新）。抽屉 SHALL 可由工具条「历史」按钮开合。

#### Scenario: 打开抽屉加载当前文件版本
- **WHEN** 选中某文件后用户点击「历史」展开抽屉
- **THEN** 系统从 office-vers 拉取该文件的版本列表并展示

#### Scenario: 切换活动文件重载版本
- **WHEN** 抽屉展开时用户切换到另一活动文件
- **THEN** 抽屉重新加载并展示新活动文件的版本列表

#### Scenario: 无历史版本时空态
- **WHEN** 当前文件在 office-vers 无任何版本（含首次访问返回 404）
- **THEN** 抽屉展示「暂无版本」空态，不报错

#### Scenario: 抽屉可收起不挤占布局
- **WHEN** 用户再次点击「历史」
- **THEN** 抽屉收起，编辑区恢复全宽，且 SHALL NOT 影响右侧 ChatPanel

### Requirement: 只读预览历史版本
系统 SHALL 在点击版本列表中某版本时，以**只读**方式呈现该版本内容；预览 SHALL NOT 修改工作区工作文件或 office-vers。呈现方式按文件类型分发：文本/图片/PDF 由前端拉取版本字节（`GET ?action=version&versionId=`）后渲染；Office 文件（`.docx`/`.doc`/`.xlsx`/`.xls`/`.pptx`/`.ppt`）经新增 `onlyoffice-version-config` 端点取 OnlyOffice 签名配置，交 DocumentServer 以 view 模式渲染（字节由后端代理供 DocumentServer 服务端拉取，前端不直接拉取 office 版本字节用于主渲染）。

#### Scenario: 点击版本进入只读预览
- **WHEN** 用户点击列表中某个版本
- **THEN** 系统按文件类型只读呈现该版本，列表中标记当前预览的版本

#### Scenario: 按文件类型选择预览方式
- **WHEN** 预览文本文件
- **THEN** 前端拉取该版本字节、解码为文本后只读呈现
- **WHEN** 预览图片或 PDF
- **THEN** 前端拉取该版本字节并直接渲染
- **WHEN** 预览 Office 文件（`.docx`/`.doc`/`.xlsx`/`.xls`/`.pptx`/`.ppt`）
- **THEN** 前端经 `onlyoffice-version-config` 取签名配置，交 OnlyOffice DocumentServer 以 view 模式渲染（只读、不提供编辑入口，与实时文件一致的保真度）

#### Scenario: OnlyOffice 未配置时回退轻量查看器
- **WHEN** 预览 Office 文件但 OnlyOffice 未配置（`onlyoffice-version-config` 返回 503 `ONLYOFFICE_DISABLED`）或取配置失败
- **THEN** 系统回退到轻量查看器：`.docx` 经 `WordViewer`、`.xlsx` 经 `ExcelViewer` 呈现；`.pptx`/`.ppt` 及其它无轻量解析的 Office 类型回退为占位提示（不阻塞）

#### Scenario: 预览不落盘
- **WHEN** 用户退出预览或切换预览版本
- **THEN** 工作区工作文件与 office-vers 版本均不变

### Requirement: 恢复指定版本回工作区
系统 SHALL 在版本预览态提供「恢复此版本」动作，把该版本内容写回工作区工作文件；恢复 SHALL NOT 在 office-vers 新建版本。

#### Scenario: 恢复前二次确认
- **WHEN** 用户点击「恢复此版本」
- **THEN** 系统弹出确认（将覆盖当前工作文件内容）；用户取消则不写入

#### Scenario: 文本文件恢复经 PUT /content
- **WHEN** 确认恢复文本文件版本
- **THEN** 系统将该版本字节解码为文本，经 `PUT /content` 写回工作文件，并失效该文件内容缓存与工作区列表缓存

#### Scenario: 二进制与 Office 文件恢复经 multipart 上传
- **WHEN** 确认恢复二进制或 Office 文件版本
- **THEN** 系统将该版本字节作为文件经 multipart `upload` 覆盖写回工作文件同路径

#### Scenario: Office 文件恢复后重挂载编辑器
- **WHEN** 恢复 Office 文件版本写回成功
- **THEN** 系统刷新 OnlyOffice 编辑器（用新 document.key 重新转换），使编辑器呈现恢复后的内容

#### Scenario: 恢复不新建版本
- **WHEN** 恢复完成后查看 office-vers 版本列表
- **THEN** 列表不因恢复而新增版本（仅工作区工作文件被覆盖）

### Requirement: 以用户 id 为命名空间直连 office-vers
系统 SHALL 经新增的 office-vers 客户端模块（base URL 取 `VITE_OFFICE_VERS_BASE_URL`）**直接**调用 office-vers，并以登录用户的 `user_id` 作为 `{uuid}` 命名空间。首版 SHALL NOT 对 office-vers 做鉴权（依赖 office-vers 开启对前端源的 CORS）。

#### Scenario: 以用户 id 作命名空间
- **WHEN** 已登录用户发起任意版本操作
- **THEN** 系统以该用户 `user_id` 作为 office-vers 路径中的 `{uuid}`

#### Scenario: login 响应携带 user_id
- **WHEN** 登录成功
- **THEN** 前端从响应读取 `user_id` 并持久化（作为 `{uuid}` 来源）
