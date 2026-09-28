# Tasks: add-turn-artifacts（前端）

## 1. 类型与客户端基础

- [x] 1.1 `npm run generate-api` 重新生成 `src/lib/openapi.d.ts`（引入 SSEArtifact/ArtifactInfo/三个版本端点类型）；本地将消息行的 `event_type` 放宽为 `string`（后端枚举缺 `artifact`，见 design D8）
- [x] 1.2 新增 `src/lib/artifact.ts`：解析 artifact 事件 content（ArtifactInfo JSON，失败返回 null）、`resolveArtifactVersion(path, before)`（react-query 友好的查询函数，`(path, before)` 缓存、404/失败返回 null）、`fetchArtifactBlob(versionId)`

## 2. 链接放行与拦截

- [x] 2.1 `markdown-renderer.tsx` 传自定义 `urlTransform`：`blowball:` 原样放行，其余走 react-markdown 默认；验证 https 外链行为不变
- [x] 2.2 自定义 `a` 组件：`blowball://workspace/` 前缀则 preventDefault + URL decode + 调 `openArtifact`；新增 `ArtifactLinkContext`（turn 产物列表 + 块 msgTime）供点击时钉版消费，context 缺失按当前版本处理

## 3. 产物归属与产物条

- [x] 3.1 `message-list.tsx` 分组：`event_type === 'artifact'` 行解析并累积进当前 turn（按 path 去重），收尾挂到该 turn 最后一个 assistant 块（无 assistant 块时独立成行）；`MessageBlock` 新增 `artifacts` 字段并在 `openBlock` 记录 msgTime；`signatureOf` 纳入 artifacts
- [x] 3.2 新增 `artifact-chips.tsx`（图标 + 文件名 + 大小，点击进 `openArtifact`）；`ChatMessage` 在块下方渲染；消息块经 context 注入钉版数据
- [x] 3.3 `turn-stream.ts` 的 `done` 分支读取 `meta.artifacts` 写入 `ui-store.turnArtifacts[sessionId]`；流式区末尾渲染同一 `ArtifactChips`；`reconcileTurnHistory` 确认历史落库后清理暂存

## 4. 打开动作与版本预览

- [x] 4.1 新增 `openArtifact(path, versionId?, ctx?)`：实现 D1 钉版顺序（turn 列表 → resolve → 降级当前版本）；versionId 为空走 `selectFile`，有值走 `ui.setArtifactPreview`
- [x] 4.2 ~~独立 artifactPreview 面板~~ → 修订：`selectFileVersion`（selectFile + 钉版，含 dirty 拦截）；`pendingSwitch` 扩展 `{path, versionId?}`，DirtyGuardDialog 确认后补钉；复用 `VersionPreviewArea`（FileToolbar 在场）
- [x] 4.3 ~~ArtifactVersionPreviewArea~~ → 修订：整体复用现有 `VersionPreviewArea`（office-vers 同空间），删除独立预览组件与代理字节拉取
- [x] 4.4 错误降级：404 提示"文件不存在或已被删除"（沿用 alert 惯例）；onlyoffice-config 503 降级下载（历史版本走 content 端点）；其余错误不使面板卡死

## 5. 验证

- [x] 5.1 `npm run lint`（tsc --noEmit）与 `npm run build` 通过
- [x] 5.2 对照交接文档验收清单逐项人工验证：链接放行与 https 回归、chip 行为、turn N 产物被覆盖后旧消息打开旧内容/工作区打开新内容、刷新后行为不变、无产物 turn 无产物条、他人 versionId 404
