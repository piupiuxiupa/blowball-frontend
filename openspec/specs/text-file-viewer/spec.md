# text-file-viewer

## Purpose

定义工作区内文本文件（非 office/pdf/图片/markdown/二进制，如 `.py`/`.ts`/`.json`/`.yml`/`.sh`/`.txt`/`.log`）的查看行为：以**自托管、按需懒加载的只读 Monaco 编辑器**渲染，提供 VSCode 级浏览能力（行号、minimap、代码折叠、文件内查找、字号缩放），按扩展名解析语言并回退纯文本，对超阈值大文件回退 Prism 只读高亮；查看器以**单个常驻实例 + model 切换**响应文件切换，且为未来「编辑 + 保存」保留单一来源驱动的只读开关。

## Requirements

### Requirement: 文本文件以只读 Monaco 查看器展示
系统 SHALL 将工作区内非 office/图片/pdf/markdown 的文本文件以 Monaco Editor 渲染，启用 VSCode 级浏览能力（行号、minimap、代码折叠、文件内查找、字号缩放），且默认为只读。

#### Scenario: 文本文件以 Monaco 只读打开
- **WHEN** 用户从文件树选中一个文本文件（如 `main.ts`、`config.yml`、`notes.txt`），且其内容未超过大文件阈值
- **THEN** 系统以只读 Monaco 编辑器展示该文件，带行号、minimap、折叠与文件内查找能力

#### Scenario: 只读不可编辑
- **WHEN** 查看器处于只读状态（默认）时用户尝试输入/修改内容
- **THEN** 编辑器不接受对内容的持久化改动，不触发任何保存或后端写入

### Requirement: 按扩展名识别语言并回退纯文本
系统 SHALL 依据文件路径扩展名，从精选语言集合解析 Monaco 语言标识；未命中精选集合的扩展名 SHALL 回退为纯文本渲染，且不报错、不中断。

#### Scenario: 已注册扩展名按对应语言高亮
- **WHEN** 选中文件扩展名在精选集合内（如 `.ts`→typescript、`.py`→python、`.yml`→yaml、`.sh`→shell）
- **THEN** 系统按对应语言的语法高亮渲染

#### Scenario: 未注册扩展名回退纯文本
- **WHEN** 选中文件扩展名不在精选集合内（如 `.log`、无扩展名文件）
- **THEN** 系统以纯文本渲染，不抛出未知语言错误、不中断查看器

### Requirement: 单编辑器实例与 model 切换
系统 SHALL 在文件查看生命周期内保持单个 Monaco 编辑器实例，文件切换时通过切换 model 响应，而非重新挂载/销毁编辑器。

#### Scenario: 切换文件不重挂载编辑器
- **WHEN** 用户在文件树中连续切换多个文本文件
- **THEN** 编辑器实例保持不变，仅其承载的 model 被替换

#### Scenario: 切回已打开文件复用 model
- **WHEN** 用户切换离开某文件后再次切回该文件
- **THEN** 系统复用此前为该文件创建的 model（基于文件路径），不重复创建

### Requirement: Monaco 自托管且不依赖外网 CDN
系统 SHALL 从应用自身的构建产物加载 Monaco 核心与 worker，不在运行时从公共 CDN（如 jsdelivr）拉取；worker 与资源路径 SHALL 遵循当前部署 `base`。

#### Scenario: 无外网环境正常加载
- **WHEN** 应用部署在无法访问公共 CDN 的内网/离线环境
- **THEN** Monaco 核心与 worker 仍从应用自身产物加载，查看器正常工作

#### Scenario: 非根部署 worker 路径正确
- **WHEN** 应用以非根 `base`（`VITE_BASE_PATH` 非默认 `/`）部署
- **THEN** worker 与静态资源 URL 遵循该 `base`，不出现 404

### Requirement: Monaco 按需懒加载
系统 SHALL 仅在需要展示文本文件时动态加载 Monaco，使不涉及文件查看的会话（如纯聊天）不承担 Monaco 的首屏与打包体积成本。

#### Scenario: 纯聊天会话不加载 Monaco
- **WHEN** 用户仅使用聊天、未打开任何文本文件
- **THEN** Monaco 相关代码不被加载到当前会话

#### Scenario: 首次打开文本文件时加载
- **WHEN** 用户首次在会话中打开一个文本文件
- **THEN** Monaco 被动态加载，加载期间展示加载占位（如 Skeleton），加载完成后渲染内容

### Requirement: 大文件回退只读高亮
系统 SHALL 在文本内容超过阈值时，回退到现有 Prism 只读高亮渲染，而不将超阈值内容喂给 Monaco。

#### Scenario: 超阈值文件回退 Prism 只读
- **WHEN** 选中文本文件的内容字节数超过阈值（初定 1 MiB）
- **THEN** 系统以现有 Prism 只读高亮展示该文件，不实例化 Monaco

#### Scenario: 未超阈值文件正常进入 Monaco
- **WHEN** 选中文本文件的内容字节数未超过阈值
- **THEN** 系统以 Monaco 查看器展示该文件

### Requirement: 只读状态由单一来源控制以支持前向兼容
系统 SHALL 将文本查看器的只读状态建模为由统一来源驱动的「模式」（取值「只读」「编辑」），默认「只读」；翻转该模式即可在只读浏览与可编辑写入之间切换，组件骨架无需重构。

#### Scenario: 默认只读打开
- **WHEN** 用户从文件树选中文本文件
- **THEN** 查看器以「只读」模式打开，内容不可被用户持久化修改

#### Scenario: 切换至编辑模式可输入
- **WHEN** 用户将模式切为「编辑」
- **THEN** 编辑器接受输入，并暴露保存入口（见「编辑内容经 PUT /content 原子落盘」需求）

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
