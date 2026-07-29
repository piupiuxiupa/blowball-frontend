## MODIFIED Requirements

### Requirement: 只读状态由单一来源控制以支持前向兼容
系统 SHALL 将文本查看器的只读状态建模为由统一来源驱动的「模式」（取值「只读」「编辑」），默认「只读」；翻转该模式即可在只读浏览与可编辑写入之间切换，组件骨架无需重构。

#### Scenario: 默认只读打开
- **WHEN** 用户从文件树选中文本文件
- **THEN** 查看器以「只读」模式打开，内容不可被用户持久化修改

#### Scenario: 切换至编辑模式可输入
- **WHEN** 用户将模式切为「编辑」
- **THEN** 编辑器接受输入，并暴露保存入口（见「编辑内容经 PUT /content 原子落盘」需求）

## ADDED Requirements

### Requirement: 非 editable 类型不提供编辑入口
系统 SHALL 按文件类型判定可编辑性：文本/代码/Markdown/JSON/HTML/CSS 可编辑；PDF、图片、二进制 SHALL NOT 提供编辑入口。Office 文件的编辑由 OnlyOffice 承担（不在本能力范围）。

#### Scenario: 不可编辑类型不显示编辑入口
- **WHEN** 当前选中文件为 PDF/图片/二进制
- **THEN** 系统不展示「编辑」入口，模式保持在只读

#### Scenario: 可编辑类型提供编辑入口
- **WHEN** 当前选中文件为可编辑文本类型（如 `.ts`/`.md`/`.json`）
- **THEN** 系统提供「只读/编辑」切换

### Requirement: 编辑内容经 PUT /content 原子落盘
系统 SHALL 在编辑态提供显式保存（保存按钮与 `Ctrl+S`），将编辑器整文件内容经 `PUT /api/v1/workspace/files/{path}/content` 原子写入；系统 SHALL 维护 dirty 标记（本地内容 ≠ 载入内容），无 dirty 时保存为空操作。保存成功 SHALL 乐观更新该文件内容缓存并失效工作区列表缓存（刷新 size/update_time）。

#### Scenario: 保存写入并清 dirty
- **WHEN** 编辑态下用户修改内容后触发保存
- **THEN** 系统以整文件内容调用 PUT /content，成功后清除 dirty、刷新文件列表的 size/update_time

#### Scenario: 含非法字节拒绝保存
- **WHEN** 待保存内容含 NUL 等非文本字节，后端返回 `BINARY_FILE`
- **THEN** 系统不清 dirty，提示「内容含非法字节，无法保存为文本」，保留本地改动

#### Scenario: 超限拒绝保存
- **WHEN** 待保存内容超过服务端大小上限，后端返回 `413`
- **THEN** 系统提示文件过大、引导改用上传，不清 dirty

#### Scenario: 无改动时保存为空操作
- **WHEN** 内容未相对载入值改变时触发保存
- **THEN** 系统不发起 PUT

### Requirement: 落盘前检测远端变更以防覆盖并发写入
由于 `PUT /content` 为无版本号盲写，系统 SHALL 在保存前重新获取文件内容/更新时间，若自本次载入后已变化，SHALL 经用户确认后方可覆盖，避免静默覆盖 Agent（`xizhi_write_file`）或他端的并发写入。

#### Scenario: 远端未变化直接保存
- **WHEN** 保存前重取结果显示文件自载入后未变化
- **THEN** 系统直接执行 PUT 落盘

#### Scenario: 远端已变化需确认
- **WHEN** 保存前重取发现文件已被修改（可能由 Agent）
- **THEN** 系统弹出覆盖确认；用户取消则不写入、保留远端版本

### Requirement: 编辑态聚焦时提示远端外部变更
系统 SHALL 在编辑态窗口重新聚焦时静默重取当前文件，若自载入后已被外部（如 Agent）修改，SHALL 以非阻塞方式提示「文件已被外部修改」，且 SHALL NOT 自动覆盖本地未保存改动。

#### Scenario: 聚焦发现远端变更只提示不覆盖
- **WHEN** 编辑态下窗口重新聚焦，重取发现文件已被外部修改
- **THEN** 系统非阻塞提示「文件已被外部修改」，不改动编辑器内本地内容

### Requirement: 编辑期抑制后台重取以保护本地改动
系统 SHALL 在某文件处于 dirty（有未保存改动）时，抑制该文件内容的后台重取（如窗口聚焦重取），避免 react-query 重取以新内容覆盖编辑器、抹掉本地未保存输入。

#### Scenario: dirty 时窗口聚焦不抹改动
- **WHEN** 编辑态下文件有未保存改动，且窗口重新聚焦触发默认 refetch
- **THEN** 该文件的内容查询不被重取，本地改动保留

### Requirement: 未保存改动切换或关闭时拦截
系统 SHALL 在存在未保存改动时，于切换活动文件或关闭查看前要求用户确认（保存 / 不保存 / 取消）。

#### Scenario: 切走带 dirty 时确认
- **WHEN** 当前文件有未保存改动，用户选中另一文件
- **THEN** 系统提示确认；选择「取消」则停留在当前文件

### Requirement: Markdown 与 HTML/JSON/CSS 的编辑态分发
系统 SHALL 在编辑态把 Markdown 切换为 Monaco 源码编辑（查看态仍为渲染），并把 JSON/HTML/CSS 在编辑态提升至 Monaco（查看态可继续 Prism 只读）。超阈值大文件在编辑态 SHALL 回退只读并提示不可在网页端编辑。

#### Scenario: Markdown 查看态渲染、编辑态源码
- **WHEN** 选中 `.md` 文件
- **THEN** 只读模式渲染 Markdown；编辑模式以 Monaco 源码呈现并可保存

#### Scenario: JSON/HTML/CSS 编辑态进入 Monaco
- **WHEN** 选中 `.json`/`.html`/`.css` 且切到编辑模式
- **THEN** 系统以 Monaco 可写编辑器呈现（而非 Prism 只读）

#### Scenario: 大文件编辑态回退只读
- **WHEN** 选中文本文件超过阈值（初定 1 MiB）且切到编辑模式
- **THEN** 系统以只读呈现并提示文件过大、不可在网页端编辑
