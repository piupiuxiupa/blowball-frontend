# Proposal: add-turn-artifacts

## Why

后端 `add-turn-artifacts` change 已落地 turn 级产物能力：agent 回复中以 `blowball://workspace/<path>` markdown 链接引用交付物，turn 末发出可持久化的 `artifact` 流事件（path、version_id、size、mime、op），并提供版本内容/版本预览/版本解析接口。前端目前对这三者均无感知：`blowball:` 链接被 react-markdown 默认 urlTransform 剥成纯文本、`artifact` 事件被流消费与历史分组双双静默丢弃、产物只能去工作区手动翻找，且文件被后续 turn 覆盖后历史引用失真。

## What Changes

- **链接放行与拦截**：markdown 渲染器放行 `blowball:` scheme（自定义 urlTransform）；自定义链接组件拦截 `blowball://workspace/<path>` 点击，不走浏览器跳转，进入统一的「打开产物」动作。普通 https 链接行为不变。裸路径不做 linkify（v1 非目标）。
- **产物条（artifact chips）**：turn 产出的文件聚合为该 turn 最后一条 assistant 消息下方的 chip 行（图标 + 文件名 + 大小）。实时流收集 `artifact` 事件渲染；历史场景从持久化的 `artifact` 消息行重建（`done` 不持久化，不作为历史数据源）。无产物的 turn 不渲染。
- **版本钉定**：点击链接时解析版本——优先命中该消息所属 turn 的 artifact 列表；未命中调 `GET /api/v1/workspace/versions/resolve?path&before=<消息时间>`；404/失败一律降级为打开当前版本。钉定发生在点击时而非渲染时，链接渲染本身永不携带版本。
- **打开动作路由**：按扩展名分发——Office 默认 OnlyOffice **view** 预览（历史版本走既有 `GET /api/v1/workspace/files/{path}/onlyoffice-version-config?versionId=`——后端版本库由 office-vers 背书，version_id 同空间）；PDF/图片内联预览；文本/代码进应用内查看器；其余触发下载。csv 与现有工作区行为一致走文本查看器（见 design D6）。历史版本字节统一走 `GET /api/v1/workspace/versions/{versionId}/content`（沿用现有 `?token=` URL 模式）。404 提示"文件不存在或已被删除"；onlyoffice-config 503 降级为下载。
- **版本预览面板复用**：artifact 版本预览复用现有 VersionPreviewArea 的渲染器族，但数据源切换为后端版本库（与 office-vers 并存，互不混用）；artifact 版本不可恢复，不展示「恢复此版本」。

## Capabilities

### New Capabilities
- `turn-artifacts`: turn 产物的链接渲染与拦截、产物条（实时/历史）、版本钉定与按类型的打开路由、artifact 历史版本只读预览。

### Modified Capabilities
<!-- 无既有需求被改变：产物相关行为全部为新能力；chat-message-render /
     chat-streaming-render / file-versioning 的现有需求保持成立。 -->

## Impact

- **消息流**：`src/lib/turn-stream.ts` 新增 `artifact` 事件收集；`src/components/chat/message-list.tsx` 分组新增 `artifact` 行归属（按位置挂到当前 turn）；`src/components/chat/markdown-renderer.tsx` 新增 urlTransform 与链接拦截组件。
- **文件预览**：`src/stores/ui-store.ts` 预览态扩展（artifact 版本来源）；`src/components/files/version-preview*.tsx`、`office-version-viewer.tsx` 数据源抽象；新增 `src/lib/artifact.ts`（后端版本库客户端 + resolve 缓存）。
- **类型**：`npm run generate-api` 重新生成 `src/lib/openapi.d.ts`（SSEArtifact、ArtifactInfo、新端点）。
- **依赖**：无新增运行时依赖。
- **后端契约**：以 `openapi.yaml` 为准（已同步）。已知缺口：Message.event_type 枚举未含 `artifact`，已反馈后端补齐，前端按开放字符串处理。
