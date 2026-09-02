## MODIFIED Requirements

### Requirement: 用户可手动将当前文件记录为版本
系统 SHALL 在文件工具条提供「记录版本」入口，对任意类型文件把当前**已落盘**的工作文件内容作为新版本上传至 office-vers（`POST /documents/{uuid}/{filepath}`）。office-vers SHALL NOT 自动记录版本——版本仅由用户显式触发产生。

#### Scenario: 记录版本成功
- **WHEN** 用户在已保存的文件上点击「记录版本」
- **THEN** 系统取当前工作文件已落盘内容并上传至 office-vers，成功后提示已记录，并在版本历史（若已展开）中体现新版本

#### Scenario: 文本文件有未保存改动时拦截
- **WHEN** 当前文本文件存在未保存改动（dirty）时用户点击「记录版本」
- **THEN** 系统**不**发起上传，并提示「当前有未保存改动，请先保存后再记录版本」

#### Scenario: Office 文件有未保存改动时拦截
- **WHEN** 当前 Office 文件在客户端编辑器中存在未保存改动（dirty）时用户点击「记录版本」
- **THEN** 系统**不**发起上传，并提示「当前有未保存改动，请先保存后再记录版本」；保存完成后再可快照最后落盘内容

#### Scenario: 未登录时不提供版本入口
- **WHEN** 用户未登录（无 `user_id`）
- **THEN** 系统不展示「记录版本」入口
