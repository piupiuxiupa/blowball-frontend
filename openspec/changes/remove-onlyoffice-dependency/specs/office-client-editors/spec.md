## ADDED Requirements

### Requirement: Office 文件在浏览器内查看与编辑
系统 SHALL 在浏览器内渲染并编辑工作区中的 `.docx` / `.xlsx` / `.pptx` 文件，全程 SHALL NOT 加载或请求 OnlyOffice DocumentServer（含其 `api.js`、配置端点与回调端点）。docx SHALL 以结构化 Block 树渲染并支持精简富文本编辑；xlsx SHALL 以电子表格网格渲染并支持单元格编辑与公式；pptx SHALL 以画布渲染并支持封闭编辑操作集。

#### Scenario: docx 文件在浏览器内打开
- **WHEN**: 用户从文件树选中一个 `.docx` 文件
- **THEN**: 系统下载文件字节并在 Worker 中解析为 Block 树，以精简富文本编辑器渲染正文结构（标题、列表、表格、图片），不发起任何 DocumentServer 请求

#### Scenario: xlsx 文件在浏览器内打开
- **WHEN**: 用户从文件树选中一个 `.xlsx` 文件
- **THEN**: 系统在浏览器内以电子表格网格渲染工作表内容（含样式与公式计算结果），不发起任何 DocumentServer 请求

#### Scenario: pptx 文件在浏览器内打开
- **WHEN**: 用户从文件树选中一个 `.pptx` 文件
- **THEN**: 系统在浏览器内以画布逐页渲染幻灯片（形状、文本、图片、表格），不发起任何 DocumentServer 请求

#### Scenario: 不加载 DocumentServer 脚本
- **WHEN**: 任一 Office 文件被打开、编辑或保存
- **THEN**: 页面网络请求中不出现 DocumentServer 的 `api.js`、`onlyoffice-config`、`onlyoffice-version-config` 或 `onlyoffice-callback`

### Requirement: 精简编辑器操作范围
docx 与 pptx 编辑器 SHALL 限定为精简操作集。docx SHALL 支持文本编辑与格式化（粗体、斜体、标题、列表、对齐）、表格内容编辑与图片插入；pptx SHALL 支持文本编辑、形状选择/移动/缩放/增删、图片替换与表格内容编辑。完整 Office 工具栏（修订、批注、母版编辑、动画等）SHALL NOT 出现。

#### Scenario: docx 精简格式化
- **WHEN**: 用户在 docx 编辑器中选中文字并应用加粗或标题样式
- **THEN**: 编辑器立即呈现对应样式并标记文档为 dirty，工具栏仅提供精简操作集

#### Scenario: pptx 形状编辑
- **WHEN**: 用户在 pptx 画布中选中一个形状并拖动或缩放
- **THEN**: 形状按操作更新位置与尺寸，文档标记为 dirty

#### Scenario: pptx 母版与动画保持只读
- **WHEN**: 用户查看含母版布局或动画的 pptx
- **THEN**: 系统不提供母版或动画编辑入口，保存后这些部件与原文件保持一致

### Requirement: Office 解析在 Web Worker 中执行
系统 SHALL 在 Web Worker 中执行 Office 文件的解析与序列化，主线程 SHALL 仅承载渲染与交互；文件字节 SHALL 以转移（transfer）方式传入 Worker，避免主线程大数组拷贝。

#### Scenario: 大文档解析不冻结 UI
- **WHEN**: 用户打开一个大体积 `.docx` 文件（如 20MB 以上）
- **THEN**: 解析在 Worker 中进行，主线程持续响应（文件树、聊天面板可交互），完成后编辑器呈现内容

#### Scenario: 解析失败时回退只读查看
- **WHEN**: 引擎解析某 Office 文件抛错（损坏文件或超出引擎能力）
- **THEN**: 系统回退到轻量只读查看器（docx 经 mammoth、xlsx 经 SheetJS），并在 UI 提示「高保真解析失败，已切换只读模式」

### Requirement: Office 编辑保存为原子二进制覆盖写
系统 SHALL 跟踪 Office 编辑器的 dirty 状态；保存时 SHALL 在 Worker 中产出新文件字节（docx 为段落级补丁，未修改内容字节保持不变；pptx 仅重写被修改部件），经二进制原子覆盖写端点写回工作区。保存前 SHALL 校验远端文件 hash，与打开时不一致 SHALL 弹出覆盖确认。

#### Scenario: 保存 docx 保留未修改内容
- **WHEN**: 用户修改 docx 中的一个段落后保存
- **THEN**: 系统以段落级补丁生成新字节并写回，文件中未修改段落的原始字节保持不变

#### Scenario: 远端变更触发覆盖确认
- **WHEN**: 文件打开后远端内容被其他进程更新，用户点击保存
- **THEN**: 系统检测 hash 不一致，弹出覆盖确认；用户确认前不写入

#### Scenario: 保存失败不破坏原文件
- **WHEN**: 二进制写请求失败（网络错误或非 2xx）
- **THEN**: 工作区原文件保持不变，编辑器保留 dirty 状态并提示保存失败

### Requirement: 历史版本以客户端引擎只读预览
版本历史抽屉中的 docx/xlsx/pptx 历史版本 SHALL 使用同一客户端引擎以只读模式预览，SHALL NOT 请求 `onlyoffice-version-config` 或依赖 DocumentServer 转换缓存。

#### Scenario: 预览历史 docx 版本
- **WHEN**: 用户在版本历史抽屉选择一个历史 `.docx` 版本
- **THEN**: 系统拉取该版本字节并以客户端引擎只读渲染，不产生工作区写入

#### Scenario: 预览历史 pptx 版本
- **WHEN**: 用户在版本历史抽屉选择一个历史 `.pptx` 版本
- **THEN**: 系统拉取该版本字节并以客户端画布只读渲染，不产生工作区写入
