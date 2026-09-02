# remove-onlyoffice-dependency

## Why

OnlyOffice DocumentServer 是当前工作区 Office 文件查看/编辑的唯一渲染与转换引擎，属于重量级外部服务（部署、CORS、混合内容、回调、SSRF 白名单一系列运维面）。GenOffice 的源码验证表明其 docx/pptx 引擎为浏览器可跑的纯 TS，xlsx 可用纯前端框架替代；把渲染与编辑搬进浏览器即可整体移除该外部依赖，同时获得对文档结构的客户端访问能力（Block 树 / 段落级补丁，契合多 agent 编辑场景）。

## What Changes

- **BREAKING**：移除 OnlyOffice 集成面——前端 `office-viewer` / `office-version-viewer` / `onlyoffice` loader / `use-office-config` / `use-office-version-config` / `onlyoffice.d.ts` / CSP 混合内容特例全部删除；不再加载 DocumentServer 的 `api.js`。
- 新增浏览器端 Office 精简编辑器（非完整 Office 工具栏）：查看 + 核心编辑 + 保存。
  - **docx**：引入 GenOffice `docx-engine`（Apache-2.0，纯 TS，Uint8Array 输入）解析 Block 树，TipTap 承载精简编辑，保存经 `saveDocx` 段落级字节补丁。
  - **xlsx**：引入 Univer（`@univerjs`）网格 + 编辑，IO 用 exceljs/SheetJS 桥接。
  - **pptx**：引入 GenOffice `pptx-engine` + `pptx-render`（RenderTree → react-konva），支持查看**与编辑**（编辑操作集按精简范围裁剪）。
- 保存管线改为：客户端引擎产出文件字节 → 原子覆盖写回工作区（依赖后端新增二进制原子写端点，见 Impact）→ office-vers 版本化语义不变。
- 解析统一在 Web Worker 中执行，避免大文档阻塞主线程。
- **legacy 格式（`.doc`/`.xls`/`.ppt`）不再渲染**：文件面板仅提供下载入口（本次决策明确：先不支持渲染，仅下载）。
- 保留现有轻量回退（mammoth/SheetJS）作为引擎失败时的只读兜底，直至新链路稳定后再评估移除。

## Capabilities

### New Capabilities
- `office-client-editors`：浏览器端 Office 精简编辑器——docx/xlsx/pptx 的查看、编辑、Worker 解析、字节级保存回写、失败兜底。
- `legacy-office-download`：legacy 二进制 Office 格式不渲染、仅下载的行为契约。

### Modified Capabilities
- `file-versioning`：Office 文件「记录版本」的快照来源措辞由 OnlyOffice forcesave 改为引擎无关的「最后落盘内容」（行为不变，仅去除对已移除服务的引用）。

## Impact

- **前端代码**：`src/components/files/office-viewer.tsx`、`office-version-viewer.tsx`、`src/lib/onlyoffice.ts`、`src/onlyoffice.d.ts`、`src/hooks/use-office-config.ts`、`use-office-version-config.ts` 重写或删除；`file-renderer` / `file-toolbar` / `version-preview` 分发逻辑更新；`main.tsx` CSP 特例清理；`file-type.ts` 的 office/legacy 判定拆分。
- **新增依赖**：vendored 引擎（GenOffice `docx-engine` / `pptx-engine` / `pptx-render`，含 `node:zlib`→pako、`node:crypto`→WebCrypto 的浏览器适配）、`@tiptap/react`、`@univerjs/*`、`react-konva`、exceljs/SheetJS（xlsx 已在依赖中）。
- **后端前置（兄弟仓库 blowball，独立 change）**：新增二进制原子覆盖写端点（现有 `PUT /content` 拒绝二进制、`POST /upload` 是目录上传语义，均不满足覆盖保存）；随后移除 `onlyoffice-config` / `onlyoffice-version-config` / `onlyoffice-callback` 三个端点与 `onlyoffice` 配置段。本 change 不改后端代码。
- **运行时**：不再需要 DocumentServer 可达性、CORS、`VITE_UPGRADE_INSECURE_REQUESTS` 对 DS 的覆盖；字体保真度策略变更（Web 端无系统字体枚举，依赖文档嵌入字体 + 内置字体子集，缺失时回退度量估算）。
- **许可**：GenOffice 代码为 Apache-2.0，vendor 时保留原始许可与出处标注。
