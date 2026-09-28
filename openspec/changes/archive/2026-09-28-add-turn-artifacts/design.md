# Design: add-turn-artifacts（前端）

## Context

后端 `add-turn-artifacts` 已提供三件套（契约以仓库根 `openapi.yaml` 为准）：

1. **链接约定**：agent 最终回复用 `[文件名](blowball://workspace/<path>)` 引用交付物；链接永不携带版本参数。
2. **artifact 流事件**：turn 末、`done` 之前每产物一条（content 为 ArtifactInfo JSON），**持久化**为消息行（`event_type="artifact"`，agent 为空）；`done.meta.artifacts` 是同内容摘要，仅实时流可达，不持久化。
3. **版本接口**：`GET /workspace/versions/resolve?path&before`、`GET /workspace/versions/{versionId}/content`（blowball 代理读取）。版本库存储后修订为 **office-vers 背书**（字节存 office-vers + MySQL 索引，见后端 design D5 修订）——**version_id 与 office-vers 同空间**，故 office 历史版本预览直接复用既有 `files/{path}/onlyoffice-version-config?versionId=`，后端未新增版本 OO 配置端点。

前端现状盘点（探查结论）：

- `markdown-renderer.tsx`：react-markdown v9，无 rehype-sanitize；但 v9 内置 `defaultUrlTransform` 只放行 http/https/irc/ircs/mailto/xmpp，`blowball:` 链接的 href 会被剥除。
- `lib/turn-stream.ts`：`consumeTurnStream` 的 switch 无 `artifact` 分支，`done` 分支仅 flush 缓冲——两者目前都被静默忽略。
- `message-list.tsx` 的 `groupMessages`：`event_type` 不匹配任何已知分支的行被跳过——artifact 行不会炸，但也不可见。
- 版本预览族（`VersionPreviewArea`/`OfficeVersionViewer`/`MediaVersionPreview`）挂在 office-vers 上；后端修订后 artifact 版本与之同空间，`ViewOnlyEditorMount` 与 `useOfficeVersionConfig` 可直接复用，仅字节读取走 blowball 代理的 `/versions/{vid}/content`。
- `MessageBlock.msgTime` 目前只有 user 块赋值。
- 项目无 toast 组件，错误提示惯例是 `alert()`。

## Goals / Non-Goals

**Goals:**
- `blowball://workspace/<path>` 链接渲染为可点击元素，点击进统一「打开产物」动作。
- 每个 turn 的产物聚合为该 turn 最后一条 assistant 消息下方的 chips（实时 + 历史一致）。
- 历史消息中的链接/chip 打开**当时版本**；工作区打开是**当前版本**。
- Office 默认 view 预览；版本不可变，不提供编辑/恢复入口。

**Non-Goals:**
- 裸路径 linkify（agent 不依从链接约定时，产物条即兜底）。
- artifact 版本的「恢复到工作区」（office-vers 版本才有恢复语义）。
- 流式中途的链接钉版（见 D1，点击时解析天然覆盖该场景）。
- 改动 office-vers 既有版本管理行为。

## Decisions

### D1: 钉版发生在点击时，而非渲染时

交接文档建议"渲染时解析 + done 到达后重新钉版"。本设计采用**点击时解析**：

```
点击 blowball://workspace/<path>
  1. 查消息所属 turn 的 artifact 列表（上下文注入）→ 命中用其 version_id
  2. 未命中 → GET resolve?path=<path>&before=<块 msgTime>
     → 200 用返回 version_id；404/网络错 → versionId 置空
  3. versionId 为空 = 打开当前版本
```

理由：
- 链接渲染产物（href、文案）因此**永不随版本状态变化**，`StreamingContent` 的段落级 memo 完全不受影响，不存在"重新钉版"这个状态。
- 流式中途点击、刷新后点击、N 个 turn 后点击，全部走同一路径，结果一致（`before` 钉死语义）。
- resolve 结果按 `(path, before)` 用 react-query 缓存（`staleTime: Infinity`——答案不可变）。

备选"渲染时钉版"被否决：它要求消息块持有解析状态并在 done 后失效重渲，与按内容 memo 的渲染契约（chat-message-render 现有需求）相冲突，且没有任何验收标准因此获益。

### D2: scheme 放行用 urlTransform，点击拦截用自定义 `a` 组件

`MarkdownRenderer` 传入自定义 `urlTransform`：`blowball:` 原样放行，其余走 react-markdown 默认逻辑（普通 https 行为不变）。自定义 `a` 组件：`href` 以 `blowball://workspace/` 开头则 `preventDefault` 并进入打开动作，否则渲染普通外链。

钉版所需上下文（所属 turn 的 artifact 列表、块 msgTime）经 **React context** 由消息块层注入；context 缺失（如 reasoning 块、流式段尚未归属）时按"当前版本"处理，不报错。

### D3: artifact 行按位置归属 turn，渲染于该 turn 最后一个 assistant 块下

不依赖 run_id（spec 未承诺 artifact 行携带 run_id；agent 字段为空）。时序上 artifact 事件在 turn 末批量发出、之后是下一条 user 消息，位置信息充分：

- `groupMessages` 遇到 `event_type === 'artifact'` 行：解析 content（JSON，失败则跳过该行），累积进**当前 turn** 的产物列表。
- 分组收尾后，产物列表挂到该 turn **最后一个 assistant 块**（`MessageBlock` 新增 `artifacts` 字段）；该 turn 无 assistant 块（如开场即错误）时渲染独立 chips 行。
- `signatureOf` 纳入 artifacts，保证块缓存正确失效。
- SSE 重连重放产生的重复行按 `path` 去重。

### D4: 实时产物条数据源 = done.meta.artifacts，落 ui-store

`consumeTurnStream` 的 `done` 分支读 `meta.artifacts` 写入 `ui-store.turnArtifacts[sessionId]`，渲染于流式区末尾（最后一条段下方）。`reconcileTurnHistory` 重拉到含 artifact 行的历史后清空该暂存——历史分组（D3）无缝接管。

选 done.meta 而非自收集 artifact 事件：done 每 turn 恰好一次（重放也是完整摘要），天然去重；artifact 事件逐条收集则需自己处理重放去重。流消费层因此只多一个字段读取，不动 rAF 缓冲机制。

### D5: 打开动作 = 与工作区同一套面板（修订）

```
openArtifact(path, ctx)
  钉版得到 versionId → selectFileVersion(path, versionId)
  versionId 为空    → selectFile(path)（Office 先置 fileViewMode=view）
```

**修订（曾用独立 artifactPreview 面板，已删）**：产物打开与工作区文件点击共用同一条路径——`selectFileVersion` 是 `selectFile` 的带钉版变体（含 dirty 拦截），切换后 `setPreviewVersionId` 复用现有 `VersionPreviewArea`（FileToolbar 在场、只读、可恢复）。版本库与 office-vers 同空间（后端 D5 修订）使该复用成立。

- `pendingSwitch` 形状扩展为 `{path, versionId?}`：dirty 拦截确认后由 DirtyGuardDialog 补钉版本，钉版不丢。
- 不新增预览组件/预览态；「无写入口」需求随独立面板一并移除（恢复能力 = 与版本历史抽屉预览一致）。
- 文本/图片/PDF 版本字节走 office-vers 直连（既有 `useVersionBlob`），不经 blowball 代理端点。

### D6: csv 走文本查看器，不进 OnlyOffice

交接文档路由表把 csv 划入 Office 行，但前端 `isOffice()`/`officeDocumentType()` 均不含 csv，工作区里 csv 就是 Monaco 文本。保持一致：csv 按文本处理。若产品后续要 csv 进 OnlyOffice，需先确认后端 config 接口支持，再动 `officeDocumentType`。

### D7: 块 msgTime = 开块首行的 msg_time

`MessageBlock` 在 `openBlock` 时记录首个事件行的 `msg_time`。`resolve` 的 `before` 用它：同 turn 产物已被步骤 1 拦截，跨 turn 引用在 turn 内任一时间点解析结果相同，首行时间足够且稳定。流式新块尚无 msgTime 时，跨 turn fallback 不可用即降级为当前版本（可接受）。

### D8: 类型生成与枚举缺口的处理

`npm run generate-api` 重新生成 `openapi.d.ts` 以获得 `SSEArtifact`/`ArtifactInfo`/新端点类型。已知缺口：`Message.event_type` 枚举未含 `artifact`（后端 spec 遗漏，已反馈），生成后 `'artifact'` 字面量比较会报 TS 错——本地将消息行类型放宽（`event_type: string`）处理，不阻塞实现。

## Risks / Trade-offs

- [后端 Message.event_type 枚举长期不含 `artifact`] → 本地放宽类型 + 已反馈后端；运行期无影响（事件行本就走字符串比较）。
- [resolve 的 `before` 精度（RFC3339）与 msg_time 精度不一致，同秒多版本边界误判] → 步骤 1（turn 自有列表）拦截了绝大多数场景，resolve 仅兜底；风险残留为极端边界下打开相邻版本，可接受。
- [agent 不依从链接约定只写裸路径] → 产物条兜底；不额外做 linkify（误伤普通文本的风险大于收益）。
- [链接指向无查看器的二进制类型] → 与现有版本预览同行为（office-vers 预览对未知类型为空白区），不单独处理。
- [OnlyOffice 未配置（503）] → 降级为下载，与交接文档一致。

## Migration Plan

纯前端增量，无数据迁移。灰度：后端能力按部署开关（无 artifact 事件时前端各路径自然空转——链接剥除修复仍生效但点击降级当前版本并 404 提示）。回滚 = revert 本 change。

## Open Questions

- 后端是否补 `Message.event_type` 枚举的 `artifact`，以及 artifact 行的 `role`/`run_id` 取值约定（前端按位置归属，不阻塞）。
- csv 的最终归类是否维持文本（D6）。
