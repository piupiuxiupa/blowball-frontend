## ADDED Requirements

### Requirement: 跨目录移动或重命名文件与目录
系统 SHALL 允许用户将工作区内文件或目录移动或重命名到任意工作区相对路径（含跨目录），经 `PUT /api/v1/workspace/files/{path}` 以 `new_path` 提交；同目录改名是该操作的退化情形。

#### Scenario: 跨目录移动文件
- **WHEN** 用户将 `reports/q2.md` 移动到 `archive/q2.md`
- **THEN** 系统以 `new_path:"archive/q2.md"` 提交，文件出现在新位置

#### Scenario: 同目录改名
- **WHEN** 用户在原目录内将 `old.md` 改名为 `new.md`
- **THEN** 系统以 `new_path`（同目录新名）提交并刷新

### Requirement: 拖入文件夹手势
系统 SHALL 支持在文件树中将节点拖拽到目录上，使其移动进该目录（`new_path` 解析为 `目录/basename`，即后端「drag into a folder」语义）；拖到工作区根区域 SHALL 移动到根。

#### Scenario: 拖文件到目录内
- **WHEN** 用户将 `q2.md` 拖拽放到目录 `archive/` 上
- **THEN** 系统以 `new_path:"archive/q2.md"` 提交

#### Scenario: 拖到根
- **WHEN** 用户将 `sub/q2.md` 拖到工作区根区域
- **THEN** 系统以 `new_path:"q2.md"` 提交

### Requirement: 目标已存在时的覆盖语义
系统 SHALL 在目标已存在时默认不覆盖（后端 `409 ALREADY_EXISTS`）；经用户二次确认后 SHALL 以 `overwrite:true` 重发以替换已存在的**文件**目标。目标是已存在目录且需合并时 SHALL 被拒绝（`409 DEST_NOT_EMPTY`），系统 SHALL 提示「目录非空，不支持合并」。

#### Scenario: 目标文件已存在需确认
- **WHEN** 移动目标的文件已存在，后端返回 `ALREADY_EXISTS`
- **THEN** 系统弹出覆盖确认；确认后带 `overwrite:true` 重发

#### Scenario: 目标目录非空拒绝
- **WHEN** 覆盖目标是已存在非空目录，后端返回 `DEST_NOT_EMPTY`
- **THEN** 系统提示目录非空、不支持合并，不执行移动

### Requirement: 禁止将目录移入自身子树
系统 SHALL 在提交前检测 `new_path` 是否等于源路径或位于源路径子树内；若是 SHALL 在客户端直接拒绝并提示，不发送请求。

#### Scenario: 目录移入自身子目录被拒
- **WHEN** 用户试图将 `reports/` 移动到 `reports/2026/` 内
- **THEN** 系统在客户端拦截并提示「不能将目录移入自身子目录」，不发请求

### Requirement: 移动后同步活动文件与缓存
系统 SHALL 在移动/重命名成功后做前缀感知同步：若活动文件是被移动文件本身或位于被移动目录内，SHALL 将活动文件路径改写到新位置；SHALL 移除旧路径的内容缓存并失效工作区列表缓存。

#### Scenario: 活动文件随移动改写
- **WHEN** 当前活动文件 `reports/q2.md` 被移动到 `archive/q2.md`
- **THEN** 系统将活动文件路径更新为 `archive/q2.md` 并刷新

#### Scenario: 活动文件位于被移动目录内
- **WHEN** 当前活动文件 `reports/sub/a.md`，目录 `reports/sub/` 被移动到 `old/sub/`
- **THEN** 系统将活动文件路径更新为 `old/sub/a.md`
