## ADDED Requirements

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
系统 SHALL 将查看器的只读状态建模为由单一来源驱动的开关（当前固定为只读），使得未来引入「编辑 + 保存」时为增量改动，而非查看器骨架的重写。

#### Scenario: 当前固定为只读
- **WHEN** 查看器渲染任意文本文件
- **THEN** 其只读开关处于启用状态，内容不可被用户持久化修改

#### Scenario: 只读开关翻转后可编辑（前向契约）
- **WHEN** 该只读开关被置为非只读（未来编辑能力启用时）
- **THEN** 编辑器接受输入且组件骨架无需重构，仅新增保存相关的数据流
