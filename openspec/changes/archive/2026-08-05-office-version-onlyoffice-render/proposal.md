## Why

历史版本预览目前无法渲染 `.pptx`（占位提示），且 `.docx` / `.xlsx` 版本由轻量库（`WordViewer` / `ExcelViewer`）渲染，与工作区实时文件经 OnlyOffice 渲染的保真度不一致——同一份文件在「实时」与「历史」下呈现效果不同。后端新增的 `onlyoffice-version-config` 端点（返回与 `onlyoffice-config` 同构的 `{server_url, edit, view}` 签名配置，但其 `document.url` 指向指定历史版本字节）使前端可经 OnlyOffice 以 view 模式渲染任意 office 历史版本，统一实时与历史的渲染路径并补齐 pptx 缺口。

## What Changes

- 新增前端 `fetchOfficeVersionConfig(path, versionId)`：调用 `GET /api/v1/workspace/files/{path}/onlyoffice-version-config?versionId=`，复用现有 `OfficeEditorResponse` 类型，仅消费 `.view`。
- 新增 `useOfficeVersionConfig(path, versionId)` hook：镜像 `useOfficeConfig`，但无 `nonce`（版本不可变，无需刷新重转换）。
- 新增 `OfficeVersionViewer` 组件（view-only）：三态机（loading → OnlyOffice 成功 / 失败回退），503 `ONLYOFFICE_DISABLED` 或配置获取失败时回退到轻量查看器。
- `VersionPreview` 的 office 分支统一收敛到 `OfficeVersionViewer`，取代 `WordViewer` / `ExcelViewer` 直渲与 pptx 占位分支。
- 回退矩阵（未配置 OnlyOffice 时）：`.docx` → `WordViewer`、`.xlsx` → `ExcelViewer`、`.pptx` → 占位提示（无轻量库可用，与当前最差情况一致）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `file-versioning`: 「只读预览历史版本」需求中「按文件类型选择预览方式」场景变更——office 历史版本统一经 OnlyOffice view 模式渲染（经新增 `onlyoffice-version-config` 端点取签名配置），仅在 OnlyOffice 未配置时回退到轻量查看器 / 占位提示。

## Impact

- **新增**：
  - `src/lib/onlyoffice.ts`：`fetchOfficeVersionConfig`（+ 复用 `OfficeEditorResponse` / `loadOnlyOfficeApi` / `officeDocumentType`）。
  - `src/hooks/use-office-version-config.ts`：`useOfficeVersionConfig`。
  - `src/components/files/office-version-viewer.tsx`：`OfficeVersionViewer`（含 view-only 编辑器挂载与回退）。
- **修改**：
  - `src/components/files/version-preview.tsx`：office 分支收敛为 `<OfficeVersionViewer>`，移除 pptx 占位与 word/excel 直渲分支。
- **复用**：`OfficeEditorResponse` 类型、`loadOnlyOfficeApi`、`officeDocumentType`、`useVersionBlob`（仅回退分支消费，OO 成功时不拉取字节）。
- **后端依赖**：`onlyoffice-version-config` 端点已就绪，响应结构与 `onlyoffice-config` 同构。
- **不触及**：恢复流程（「恢复此版本」仍写字节回工作区工作文件并退出预览，与本变更解耦）。
