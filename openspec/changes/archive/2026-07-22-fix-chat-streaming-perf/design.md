## Context

当前流式问答渲染链路（`use-send-message.ts` → `ui-store.ts` → `message-list.tsx` → `token-stream.tsx` → `markdown-renderer.tsx`）存在 O(n) 重渲染风暴：

- 每个 token 触发一次 `appendToken`（整对象 spread + 字符串拼接）→ `MessageList` 订阅的 `streamingTokens[sessionId]` 值变化 → 整树重渲染。
- `TokenStream` 里 `splitStreamingContent` 每次返回全新的 `completed` 数组，配合未 memo 的 `MarkdownRenderer` 与 `key={idx}`，导致**每个 token 都把所有已完成段落重新解析 Markdown**；含代码块时还要全量重跑 Prism 高亮（`react-syntax-highlighter` 的 `Prism` 默认注册 ~270 种语言）。
- token 更新无节流；后端吐字快时主线程被占满 → 卡死。
- `groupMessages` 在消息重拉取后返回全新 block 对象，使所有 `ChatMessage` 的 memo 失效，长会话刷新一次性卡顿。

约束：纯前端改动，不动后端 SSE 契约；保持现有「正在输入的最后一行用纯文本展示」的视觉行为；节流不得引入可感知延迟。

## Goals / Non-Goals

**Goals:**
- 把流式渲染频率压到 ≤60fps（每帧最多一次提交）。
- 单个 token 不再触发已完成段落/已完成消息的 Markdown 重解析与代码重高亮。
- 长会话（数百条消息）滚动与切换流畅，重拉取不引起全量重渲染。
- 缩减代码高亮的打包体积与单次高亮开销。

**Non-Goals:**
- 不改后端 API / SSE 协议。
- 不改 Markdown 渲染的视觉样式（prose 主题、配色不变）。
- 不引入 SSR 或离线缓存。
- 不重写聊天整体架构（仍 react-query + zustand）。

## Decisions

### D1：token 批量节流放在 SSE 消费侧（rAF + 累积缓冲），而非 store 内部
- 方案：在 `use-send-message.ts` 的 `for await` 循环里把 token 累积进一个本地 buffer；用 `requestAnimationFrame` 每帧最多调一次新的 `appendTokenBatch(sessionId, chunk)`（一次 set 追加整段 chunk）。
- 理由：rAF 与浏览器绘制对齐，渲染不会快于屏幕刷新；store 保持同步、简单。时间节流（如 50ms）会在低刷新率设备上丢帧，rAF 更稳。
- 备选：在 store 内部缓冲 + 自启 rAF → 增加 store 副作用复杂度，且 abort/done 时机难协调，故不选。
- 收尾：`done` / `agent_error` / `abort` 时**同步 flush** 剩余 buffer，避免丢失尾部 token（≤16ms 内不会被用户感知）。

### D2：已完成段落「按段增量渲染 + 稳定 key + memo」
- 方案：把 `splitStreamingContent` 的切分单位从「单行」改为「段落」（以空行或确定边界切分），并对每个段落包一个 `React.memo` 的 `StreamSegment`（内部即 `MarkdownRenderer`）。key 用段落的**起始字符偏移**（单调递增、仅追加），而非数组索引。
- 理由：memo 后，仅新增段落会挂载/解析，已有段落按字符串浅比较跳过；段落单位比单行更少、更稳定，也符合 Markdown 语义。
- 备选：保留行级切分 → 段落数过多、key 仍易漂移，收益小。

### D3：`MarkdownRenderer` 整体 `React.memo`
- 方案：`export const MarkdownRenderer = memo(function MarkdownRenderer(...))`，props 仅 `children: string` 与可选 `className`，默认浅比较即足够。
- 理由：最小改动消除「已完成消息每次重渲染都重解析」。内容是 string，浅比较安全。

### D4：代码高亮 = memo 化的 `CodeBlock` + `PrismLight` 按需注册
- 方案：
  1. 新增 `CodeBlock` 组件，`React.memo` 于 `(language, value)`，避免重复渲染重跑高亮。
  2. 将 `import { Prism as SyntaxHighlighter }` 换成 `PrismLight`，显式 `registerLanguage` 一个精选集合（如 ts/js/jsx/tsx/python/go/rust/java/c/cpp/bash/json/yaml/sql/html/css/markdown），未知语言回退为普通 `<pre>`（不高亮但仍可读）。
- 理由：同时拿到「按内容跳过高亮」与「打包体积/单次成本下降」两份收益，改动局部。
- 备选：换 `shiki` → 质量最佳但需异步初始化、改动大、首屏更重，本期不做（列入后续）。

### D5：`groupMessages` 输出稳定对象复用
- 方案：在 `message-list.tsx` 维护一个 `useRef<Map<blockId, MessageBlock>>`；每次 `groupMessages` 时，若某 block 的底底层消息 id 序列 + 内容签名未变，则**复用上一次的对象引用**。
- 理由：使 `ChatMessage` 的 `React.memo` 在 `invalidateQueries` 重拉取后仍生效，长会话刷新不再全量重渲染。
- 备选：在 react-query 层做结构共享 → 复杂且侵入框架行为，不选。

### D6：消息列表虚拟滚动（`@tanstack/react-virtual`）
- 方案：在 `MessageList` 用 `useVirtualizer` 对 `blocks` 做动态高度虚拟化；流式尾部的 `TokenStream` 作为虚拟列表的最后一个 item 一同参与（保证滚动到底与渲染一致）。用 `measureElement` 处理可变高度。
- 理由：与现有 `@tanstack/react-query` 同生态、体积小；解决长会话 DOM 节点数过大问题。
- 阈值：始终启用虚拟化（统一路径，避免两套渲染分支）；若实测短列表有回归，再加 `>` N 阈值。

## Risks / Trade-offs

- [rAF 批量让最后一个 token 最多延迟 ~16ms 显示] → 在 done/error/abort 同步 flush；人眼不可感。
- [PrismLight 精选语言遗漏某种语言] → 回退普通 `<pre>`，代码仍可读、可复制，仅无配色。
- [虚拟滚动影响浏览器原生 Ctrl+F 查找 / 跨节点复制] → 已知限制；超长会话下整体可用性优先，文档注明。
- [稳定对象复用的 Map 内存随会话增长] → 会话切换 / 卸载时清空；按会话消息数有界。
- [memo 化可能掩盖本应更新的内容] → 内容均为 string/稳定 props，浅比较正确；流式尾行仍由独立纯文本节点承担实时更新。

## Migration Plan

- 纯前端，无数据迁移、无后端变更。
- 按决策顺序合入：D3+D1+D2（流式链路）→ D4（高亮）→ D5（稳定标识）→ D6（虚拟化），每步可独立验证。
- 回滚：直接 revert 对应提交，无副作用残留。

## Open Questions

- PrismLight 精选语言清单是否需覆盖更多（如 php/ruby/scala）？默认按上文集合，可后续按用量补充。
- 虚拟滚动是否需要对「滚动到底」与「用户上滑浏览历史」的现有交互做额外适配（`isNearBottom` 判定依赖 `scrollHeight`，虚拟化下仍成立，需实测）。
