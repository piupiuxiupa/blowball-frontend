# remove-onlyoffice-dependency — Tasks

> 外部前置（兄弟仓库 blowball，独立 change）：二进制原子覆盖写端点。其就绪前，本仓库任务 6.1 先以 `POST /upload` 临时路径联调；端点就绪后切换为正式端点。其余任务不依赖后端改动。

## 1. Vendor 引擎与浏览器适配

- [x] 1.1 从 GenOffice（记录上游 commit hash）拷贝 `docx-engine` / `pptx-engine` / `pptx-render` 源码到 `src/vendor/genoffice/`，保留 Apache-2.0 头与 NOTICE 出处
- [x] 1.2 浏览器依赖替换：`node:zlib.deflateSync`→pako、`node:crypto`（randomUUID/createHash）→WebCrypto/uuid，通过 tsc 验证 vendor 目录无 `node:` import
- [x] 1.3 把 pptx 解析链改造为纯函数入口（Uint8Array→deck 模型 + RenderSlide），剥离 Electron/IPC 依赖
- [x] 1.4 抽象字体度量接口：嵌入字体提取注册优先、内置中英文字体子集（体积预算 ≤15MB）、缺失时度量估算并供 UI 标注
- [x] 1.5 安装前端依赖：`@tiptap/react`、`@univerjs/*`、`react-konva`、`exceljs`、`pako`、`uuid`，并跑通构建

## 2. Worker 解析层

- [ ] 2.1 实现 `office-engine-worker`：主线程 fetch 字节 → transfer 传入 → 解析返回可结构化克隆模型（媒体转 Blob URL 引用）
- [ ] 2.2 定义引擎错误协议与上限（字节/部件数/解析超时），超限走「文件过大，请下载」降级
- [ ] 2.3 保存序列化进 Worker：docx `saveDocx` 段落补丁、pptx 仅重写被修改部件、xlsx 经 exceljs 产出

## 3. docx 精简编辑器

- [ ] 3.1 Block 树 → TipTap 文档模型转换 + 只读渲染（标题/列表/表格/图片）
- [ ] 3.2 精简工具栏与编辑：粗斜体、标题、列表、对齐、表格内容编辑、图片插入；dirty 跟踪
- [ ] 3.3 编辑结果 → SaveBlock 生成（未修改段落 passthrough），与 2.3 的保存链路打通

## 4. xlsx 编辑器

- [ ] 4.1 集成 Univer 网格：SheetJS 读取工作簿 → Univer 数据模型渲染（样式、多 sheet）
- [ ] 4.2 单元格编辑与公式计算，dirty 跟踪
- [ ] 4.3 保存：Univer 编辑结果 → exceljs 写出 xlsx 字节（保留未修改 sheet 的原始数据）

## 5. pptx 编辑器

- [ ] 5.1 RenderTree → react-konva 只读渲染（逐页画布、缩放、页导航）
- [ ] 5.2 编辑操作集：文本编辑、形状选择/移动/缩放/增删、图片替换、表格内容编辑；母版/动画/SmartArt 只读
- [ ] 5.3 编辑结果回写 deck 模型 → 部件级保存（未修改部件字节不变）

## 6. 保存管线与文件面板整合

- [ ] 6.1 二进制保存 API 客户端：后端端点就绪前用 `POST /upload` 临时联调，就绪后切 PUT 覆盖写；失败保留 dirty 并提示
- [ ] 6.2 保存前 hash 冲突校验 + 覆盖确认对话框（复用 dirty-guard 模式）
- [ ] 6.3 `file-type.ts` 拆分 office/legacy 判定；`file-renderer` 分发到三个客户端编辑器；legacy 渲染下载卡片并隐藏编辑入口
- [ ] 6.4 历史版本预览切换为客户端引擎只读渲染（`office-version-viewer` 重写），移除 `onlyoffice-version-config` 请求
- [ ] 6.5 `file-versioning`：Office 文件 dirty 时拦截「记录版本」，与文本文件语义对齐

## 7. 拆除 OnlyOffice 与验收

- [ ] 7.1 `VITE_OFFICE_ENGINE` flag 并行期：client 默认、onlyoffice 可回滚；三格式打开/编辑/保存/版本预览手工验收
- [ ] 7.2 删除 OnlyOffice 前端面：`office-viewer`、`lib/onlyoffice`、`use-office-config`、`use-office-version-config`、`onlyoffice.d.ts`、`main.tsx` CSP 特例与相关 openapi 引用
- [ ] 7.3 验收：构建/lint 通过；网络面板无 DocumentServer 请求；mammoth/SheetJS 兜底路径有效；更新 `.env.example` 文档
