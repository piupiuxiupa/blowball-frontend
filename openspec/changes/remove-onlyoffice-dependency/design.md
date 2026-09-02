# remove-onlyoffice-dependency — Design

## Context

当前 Office 文件（docx/xlsx/pptx 及 legacy doc/xls/ppt）的查看与编辑完全委托 OnlyOffice DocumentServer：后端签发 edit/view 双 JWT 配置，前端动态加载 `api.js` 挂载编辑器，编辑保存经 DS 回调下载落盘。DS 同时承担 legacy 格式转换。该服务是工作区功能里唯一的重量级外部运行时依赖。

对 GenOffice（Apache-2.0，Electron 套件）源码的调研结论：

- `packages/docx-engine`（~2 万行）：纯 TS、无 Node 依赖、`Uint8Array` 输入；docx → Block 树（`docxIndex` 锚点 + 原始 XML 切片 passthrough），保存为原始 zip 上的段落级字节补丁。浏览器可直接复用。
- `packages/pptx-engine` / `pptx-render`：RenderTree（EMU→px、opentype.js 文本度量、bidi-js）+ react-konva 渲染；解析链含 `node:zlib`/`node:crypto` 两处 Node 依赖，且在 Electron 主进程执行——需要 Web 化改造。
- Sheets 链路的 xlsx 读写核心是 Rust 原生 sidecar（calamine/ironcalc），浏览器不可用；但其网格 UI 本身是 Univer（`@univerjs`，纯前端），可不经 GenOffice 直接引入。

已确认的产品决策：精简编辑器（非完整 Office 工具栏）；pptx 必须支持编辑；legacy 格式仅下载不渲染。

## Goals / Non-Goals

**Goals:**

- 浏览器内完成 docx/xlsx/pptx 的查看、编辑、保存，全程不依赖 DocumentServer。
- 保存语义与现有文本编辑对齐：原子覆盖写、dirty 跟踪、保存前冲突校验、office-vers 版本化不受影响。
- 解析不阻塞主线程（Worker 化），大文件有明确的失败与兜底路径。
- legacy 格式给出明确降级行为（仅下载）。

**Non-Goals:**

- 不做完整 Word/Excel/PPT 工具栏、修订/批注/协同编辑（单人工作区，DS 的协同能力本就未使用）。
- 不做 legacy 格式渲染或服务端转换。
- 不在本 change 修改后端代码（二进制写端点与 DS 端点拆除在 blowball 仓库独立立项）。
- 不追求像素级 Office 保真；目标是结构忠实 + 可靠往返（不破坏文档）。

## Decisions

### D1：按格式选引擎——docx/pptx 借 GenOffice，xlsx 用 Univer

- **docx**：vendor `docx-engine`。理由：纯 TS、零 Node 依赖、Block/SaveBlock 模型天然契合后续 agent 增量编辑；mammoth 只能单向有损转 HTML，docx-preview 只读且保真有限。编辑器用 TipTap（GenOffice 同款底座，但**只实现精简扩展集**：标题/列表/粗斜体/对齐/表格基础编辑/图片，不搬其 7.6 万行完整 renderer）。
- **xlsx**：`@univerjs` + exceljs（写）/SheetJS（读，已在依赖中）。理由：GenOffice 的 Rust sidecar 不可移植；Univer 本身是成熟的纯前端表格框架，npm 直用避免 vendor 维护。
- **pptx**：vendor `pptx-engine` + `pptx-render` + react-konva。理由：纯前端 pptx 渲染没有像样的替代品；`pptx-render` 的数据驱动 RenderTree 与 Konva 适配层是薄边界，适合抽用。编辑实现为**操作集子集**：文本编辑、形状增删/移动/缩放、图片替换、表格编辑；母版/动画/SmartArt 保持只读 passthrough。

### D2：vendor 方式为源码目录拷贝 + 浏览器适配层，不 fork 整仓

引擎以 `src/vendor/genoffice/{docx-engine,pptx-engine,pptx-render}` 形式拷入（保留 Apache-2.0 头与 NOTICE 出处），只做三类改造：
1. `node:zlib.deflateSync` → pako；`node:crypto`（randomUUID/createHash）→ WebCrypto/uuid。
2. 把 pptx 解析链从"主进程函数"改为纯函数入口（输入 Uint8Array，输出 deck 模型 + RenderSlide），移除 IPC 依赖。
3. 字体度量入口抽象为接口（见 D5），替换桌面端系统字体枚举。

不建 git subtree（上游包未发布、exports 指 `src/index.ts`、workspace 依赖交织；拷贝 + 记录上游 commit 更可控）。

### D3：解析与序列化全部 Worker 化

统一 `office-engine-worker`：主线程 fetch 文件字节 → postMessage(transfer Uint8Array) → Worker 内 parse → 返回可结构化克隆的模型（图片等媒体转 Blob URL 引用）。保存反向走 Worker（序列化/补丁在 Worker 产出字节）。理由：docx-engine 按桌面内存设计（zip 上限 1.5GB），浏览器主线程 parse 大文档会冻结 UI。

### D4：保存管线复用文本编辑的冲突语义，经新二进制端点落盘

打开时记录文件字节 hash → 编辑器 dirty 跟踪 → 保存前重新 HEAD/下载校验远端 hash，不一致弹覆盖确认（对齐 `use-file-edit` 现有语义）→ 引擎在 Worker 产出新字节 → `PUT` 二进制原子写端点（后端前置）→ 刷新 workspace 查询缓存。不引入 ETag 新协议，hash 校验用现有下载能力即可。

### D5：字体策略——嵌入字体优先 + 内置子集 + 度量估算回退

opentype.js 度量需要字体文件。策略：pptx/docx 内嵌字体（引擎已支持提取）优先注册；内置一份常用中英文字体子集（供度量与回退渲染）；缺失字体按 metrics 表估算并给 UI 标注"字体缺失"。不做系统字体枚举（Web 做不到）。

### D6：legacy 格式仅下载

`.doc/.xls/.ppt` 在 `file-type` 判定为 legacy-office，`file-renderer` 直接渲染下载卡片（复用现有 download 端点），不进入任何编辑器，工具条隐藏编辑入口。

### D7：并行期 feature flag，最后拆除

`VITE_OFFICE_ENGINE=client|onlyoffice`（默认 client）。并行期内两条链路共存可回滚；client 链路对三格式 + 历史版本预览全部验收后，删除 OnlyOffice 全部前端代码与 flag。mammoth/SheetJS 轻量查看器保留为引擎解析失败的只读兜底。

## Risks / Trade-offs

- [pptx 编辑范围失控] → 操作集在 spec 中封闭列举（文本/形状/图片/表格），母版与动画显式只读；超出集合的操作 UI 不出现。
- [vendor 引擎与上游漂移] → vendor 目录头部记录 GenOffice commit hash；不改引擎内部逻辑，适配只发生在边界层。
- [大文件 OOM/超时] → Worker 内设字节与部件数上限（低于桌面引擎默认值），超限走"文件过大，请下载"降级；解析失败回退 mammoth/SheetJS 只读。
- [保真度低于 DocumentServer] → 明确产品预期为"结构忠实 + 往返不破坏"；docx 保存是段落级补丁（未动内容字节不变），pptx 保存只重写被修改部件。
- [字体缺失导致排版偏差] → D5 三级策略 + UI 明示；不做静默错排。
- [后端二进制写端点未就绪阻塞联调] → 前端先用 `POST /upload` 到临时路径联调引擎链路，端点就绪后切换；该依赖在 tasks 中显式标注。

## Migration Plan

1. 后端（独立 change）提供二进制原子覆盖写端点；前端 vendor 引擎并 Worker 化。
2. flag 默认 `client` 上线，OnlyOffice 链路保留为回滚开关；观察三格式打开/编辑/保存与版本快照。
3. 验收后删除 OnlyOffice 前端代码、`file-versioning` 措辞去 DS 化；后端随后拆除三个 DS 端点与配置（独立 change）。

## Open Questions

- 内置字体子集的覆盖范围与体积预算（候选：思源黑体子集 + Latin 常用体，目标增量 <15MB）——实现期定稿。
- pptx 表格编辑是否进第一期操作集，或先只读表格 + 文本/形状编辑——建议 tasks 中作为可拆分项。
