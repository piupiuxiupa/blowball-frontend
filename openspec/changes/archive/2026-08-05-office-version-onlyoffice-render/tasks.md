## 1. 数据层：版本配置 fetch

- [x] 1.1 在 `src/lib/onlyoffice.ts` 新增 `fetchOfficeVersionConfig(path, versionId)`：`apiGet<OfficeEditorResponse>` 调用 `GET /api/v1/workspace/files/{encodeURIComponent(path)}/onlyoffice-version-config?versionId=${encodeURIComponent(versionId)}`，复用现有 `OfficeEditorResponse` 类型（不新增类型）。JSDoc 注明只消费 `.view`、版本不可变、由后端按 versionId 派生稳定 document.key。

## 2. Hook：useOfficeVersionConfig

- [x] 2.1 新建 `src/hooks/use-office-version-config.ts`，导出 `useOfficeVersionConfig(path, versionId)`：`useQuery`，queryKey `['office-version-config', path, versionId]`（无 nonce），`enabled: !!path && !!versionId`，`staleTime: Infinity`，`retry: false`。镜像 `use-office-config.ts` 结构。

## 3. 组件：OfficeVersionViewer（三态机 + 回退）

- [x] 3.1 新建 `src/components/files/office-version-viewer.tsx`，导出 `OfficeVersionViewer({path, versionId})`。内部 `useOfficeVersionConfig(path, versionId)` 驱动三态：loading → skeleton；200 → view-only OnlyOffice 挂载；error → 回退分支。
- [x] 3.2 实现 view-only 编辑器挂载（组件内联或同文件子组件）：`loadOnlyOfficeApi(data.server_url)` 后 `new window.DocsAPI.DocEditor(editorId, {...data.view.config, token: data.view.token, width/height: '100%', events:{onAppReady, onError}})`，复用 `office-viewer.tsx` 的 `LOAD_TIMEOUT_MS` 超时与卸载 `destroyEditor` 生命周期模式；editorId 用 sanitized `useId()`。始终 view，永不取 `.edit`。
- [x] 3.3 实现回退分支：error 态下 `useVersionBlob(path, versionId)`（`enabled` 仅在回退时为真，OO 成功不拉字节）；按扩展名分发 `.docx`→`<WordViewer path url={objectUrl}>`、`.xlsx`→`<ExcelViewer path url={objectUrl}>`、`.pptx`/`.ppt`/其它→占位提示（复用 `version-preview.tsx` 现有占位文案/图标）。blob→objectURL 的 create/revoke 用 `useEffect` 管理。

## 4. 接线：VersionPreview 收敛 office 分支

- [x] 4.1 改 `src/components/files/version-preview.tsx`：office（`isWord`/`isExcel`/`isSlide`，或用 `isOffice(ext)`）分支统一渲染 `<OfficeVersionViewer path={path} versionId={versionId} />`，移除原 `WordViewer`/`ExcelViewer` 直渲与 pptx 占位分支。文本/图片/PDF 分支保持不变。
- [x] 4.2 清理：若 `WordViewer`/`ExcelViewer` 的导入在 `version-preview.tsx` 不再被引用则移除（确认这些组件仍被 `file-renderer.tsx` 等其它地方使用，不删组件本身）。

## 5. 验证

- [x] 5.1 `npm run build` 通过（`tsc -b && vite build`，无类型错误 / 未用导入告警）。
- [x] 5.2 手动：配置 OnlyOffice 时，对 `.docx`/`.xlsx`/`.pptx` 历史版本点击预览，确认经 OnlyOffice view 模式渲染、无编辑入口。
- [x] 5.3 手动：未配置 OnlyOffice（或断开后端 OO）时，`.docx`→WordViewer、`.xlsx`→ExcelViewer 回退正常，`.pptx`→占位提示。
- [x] 5.4 手动：退出预览 / 切换版本 / 「恢复此版本」流程不受影响（恢复仍写字节回工作区并退出预览）。
