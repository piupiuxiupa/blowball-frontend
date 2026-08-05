## Context

工作区 office 文件（`.docx`/`.xlsx`/`.pptx` 及 legacy `.doc`/`.xls`/`.ppt`）的**实时**查看经 OnlyOffice：前端 `fetchOfficeConfig` → 后端 `onlyoffice-config` 端点构建并签名 DocEditor 配置（HS256 JWT），前端把 `{...config, token}` 交给 `DocsAPI.DocEditor`，DocumentServer 服务端按 `document.url` 拉取字节并渲染。`OfficeEditorResponse = {server_url, edit:{config,token}, view:{config,token}}`，前端按 ui-store 的 `fileViewMode` 选 edit/view。

**历史版本**预览现状（`version-preview.tsx`）：前端直连 office-vers 拉版本字节（`useVersionBlob`），按类型分发——文本→`CodeViewer`、图片/PDF→对应 viewer、`.docx`→`WordViewer`(docx-preview)、`.xlsx`→`ExcelViewer`(SheetJS)、`.pptx`→占位提示。两条路径分离：实时走 OnlyOffice（高保真、可编辑），历史走轻量库（低保真、pptx 缺失）。

后端新增 `onlyoffice-version-config?versionId=`：返回与 `onlyoffice-config` **同构**的 `OfficeEditorResponse`，区别在其 `document.url` 指向指定历史版本字节（后端按调用方 JWT 推 user uuid，从 office-vers 取该版本字节代理给 DocumentServer）。这使历史版本可走与实时一致的 OnlyOffice 渲染路径。

约束：
- OnlyOffice secret 永不落地浏览器，配置由后端签名。
- 版本不可变：只读预览，无编辑、无 `callbackUrl`、无 forcesave。
- `document.key` 由后端按 `versionId` 确定性派生（稳定 key → DocumentServer 缓存转换结果，重开即取）。

## Goals / Non-Goals

**Goals:**
- office 历史版本（含 pptx）经 OnlyOffice view 模式渲染，保真度与实时一致。
- OnlyOffice 未配置（503）/取配置失败时回退到现有轻量查看器，不阻断预览。
- 复用实时路径的基础设施（`OfficeEditorResponse` 类型、`loadOnlyOfficeApi`、`officeDocumentType`）。

**Non-Goals:**
- 不改动实时文件的 `onlyoffice-config` 路径与 `OfficeViewer`。
- 不改动恢复流程（「恢复此版本」仍写字节回工作区工作文件，与本变更解耦）。
- 不为 office 版本引入编辑能力（永远 view-only）。
- 不抽取实时/版本共用的「EditorMountCore」——版本挂载逻辑更简单（无 mode/nonce），两处重复约 40 行可接受；待第三个调用方出现再重构。

## Decisions

### 决策 1：复用 `OfficeEditorResponse` 类型，仅消费 `.view`
后端 `onlyoffice-version-config` 返回与 `onlyoffice-config` 同构的 `{server_url, edit, view}`。前端 `fetchOfficeVersionConfig` 直接复用 `OfficeEditorResponse`，**只读 `.view`**，忽略 `.edit`。view-only 语义由前端强制（永不取 `.edit`/永不切 mode），而非由响应形状表达。
- *替代方案*：定义扁平的 `{server_url, config, token}` 新类型。否决——后端已定型为同构，复用类型零成本且减少分歧。

### 决策 2：三态机组件 + 懒加载 blob 回退
`OfficeVersionViewer` 是显式三态机：
```
mount(versionId) → LOADING(useOfficeVersionConfig)
                      ├─ 200 → SUCCESS: ViewOnlyEditorMount(OnlyOffice)
                      └─ 503/err → FALLBACK: useVersionBlob(lazy) → WordViewer/ExcelViewer/占位
```
`useVersionVersionConfig` 总是发起（决定走哪条路）；`useVersionBlob` **仅在回退分支启用**（`enabled: isFallback`），OO 成功时不拉取版本字节——避免无谓下载。
- *替代方案*：并行同时发 OO 配置与 blob 请求，OO 成功则丢弃 blob。否决——浪费带宽，版本可能很大。

### 决策 3：无 nonce / 无刷新——版本不可变
实时路径用 `nonce`（刷新按钮 bump）让后端 mint 新随机 `document.key` 强制重转换，避免 stale 缓存。版本不可变，**无 stale 风险**：后端按 `versionId` 确定性派生稳定 `document.key`，DocumentServer 缓存转换结果，重开即取（更快）。因此版本查看器无刷新按钮、无 `nonce`、`useOfficeVersionConfig` 的 query key 仅 `[path, versionId]`，`staleTime: Infinity`。

### 决策 4：独立 `OfficeVersionViewer`，不复用 `EditorMount`
实时 `EditorMount`（`office-viewer.tsx`，未导出）耦合了 `{edit,view}` 双配置、ui-store `fileViewMode`、`nonce`、keyed 重挂载。版本查看器只需 view-only、无 mode、无 nonce——形状不同。新建独立 `OfficeVersionViewer`（内含 view-only 挂载：`loadOnlyOfficeApi` → `new DocsAPI.DocEditor` → `onAppReady`/`onError` + 超时 + 卸载 `destroyEditor`），约 40 行与 `EditorMount` 重复，换取零耦合。
- *替代方案*：抽取共享 `EditorMountCore({serverUrl, config, token})` 由两处复用。推迟——当前仅 2 个调用方且形状不同，抽象收益不抵重构风险。

### 决策 5：回退矩阵显式枚举，pptx 接受「无轻量回退」
503/失败时按扩展名回退：`.docx`→`WordViewer`、`.xlsx`→`ExcelViewer`、`.pptx`/`.ppt` 及其它→占位提示。pptx 无轻量库可用，回退到占位——这与**变更前**的 pptx 最差情况完全一致，本变更只在 OO 可用时改善它，不引入新回归。

## Risks / Trade-offs

- **[DocumentServer 不可用时 office 版本预览退化为轻量/占位]** → 回退链已覆盖；pptx 在此情况仍占位（与现状一致，非回归）。
- **[OO 配置请求延迟叠加 OnlyOffice 转换延迟，版本预览首屏比轻量库慢]** → 不可变版本用稳定 `document.key` 让 DocumentServer 缓存转换，二次打开即取；首屏用 skeleton 占位。可接受——保真度优先。
- **[后端 `onlyoffice-version-config` 实际响应与 `onlyoffice-config` 不同构]** → 复用 `OfficeEditorResponse` 类型会在运行时暴露字段缺失（DocEditor 报错）。缓解：实现前对照后端 handler 确认响应形状（已由用户确认同构）。
- **[回退分支 `useVersionBlob` 的 query key 与 `version-preview` 现有调用共用]** → react-query 自动复用同 key（`['file-version-blob', userId, path, versionId]`）的缓存，回退命中已有 blob 缓存，无重复请求。
