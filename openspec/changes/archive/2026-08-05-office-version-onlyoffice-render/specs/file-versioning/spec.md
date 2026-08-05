## MODIFIED Requirements

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
