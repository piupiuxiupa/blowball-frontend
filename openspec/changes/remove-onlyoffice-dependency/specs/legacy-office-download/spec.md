## ADDED Requirements

### Requirement: legacy Office 格式仅提供下载
系统 SHALL 对 `.doc` / `.xls` / `.ppt` 格式不提供任何浏览器渲染或编辑，文件面板 SHALL 展示下载入口；工具条 SHALL 对这些格式隐藏编辑与查看模式切换。

#### Scenario: 打开 legacy 文件展示下载卡片
- **WHEN**: 用户从文件树选中一个 `.doc`、`.xls` 或 `.ppt` 文件
- **THEN**: 中间面板展示包含文件名、大小与「下载」按钮的提示卡片，不实例化任何 Office 引擎，不请求 DocumentServer

#### Scenario: legacy 文件不出现编辑入口
- **WHEN**: legacy 格式文件为当前活动文件
- **THEN**: 工具条不展示「编辑」/「查看」模式切换，快捷保存入口不可用

#### Scenario: legacy 历史版本同样仅下载
- **WHEN**: 用户在版本历史抽屉查看 legacy 格式的历史版本
- **THEN**: 该版本预览区展示下载入口，不尝试渲染
