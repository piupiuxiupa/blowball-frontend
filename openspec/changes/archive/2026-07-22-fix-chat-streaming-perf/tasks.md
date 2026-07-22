# Tasks

## 1. 依赖与基础准备

- [x] 1.1 安装 `@tanstack/react-virtual` 作为虚拟滚动依赖
- [x] 1.2 确认 `react-syntax-highlighter` 的 `PrismLight` 入口可用（不新增依赖，仅调整导入路径）
- [x] 1.3 `openspec` 校验：`openspec validate fix-chat-streaming-perf --strict` 通过

## 2. Markdown 渲染 memo 化（D3）

- [x] 2.1 将 `src/components/chat/markdown-renderer.tsx` 的 `MarkdownRenderer` 用 `React.memo` 包裹（props：`children: string`、`className?`）
- [x] 2.2 `npm run lint`（tsc --noEmit）通过，确认未破坏既有调用点（`token-stream.tsx`、`chat-message.tsx`）

## 3. 流式 token 批量节流（D1）

- [x] 3.1 在 `src/stores/ui-store.ts` 新增 `appendTokenBatch(sessionId, chunk)` 与 `appendReasoningTokenBatch(sessionId, chunk)`，一次 set 追加整段 chunk
- [x] 3.2 在 `src/hooks/use-send-message.ts` 的 SSE 循环中引入本地 buffer + `requestAnimationFrame`：token/reasoning 先入缓冲，每帧最多 flush 一次到 batch 接口
- [x] 3.3 处理 `done` / `agent_error` / `abort` 时**同步 flush** 剩余缓冲后再清理状态；取消时移除 rAF 句柄避免泄漏
- [x] 3.4 验证：高频 token 下 React DevTools Profiler 显示每帧至多一次 `MessageList` 提交

## 4. 已完成段落增量渲染（D2）

- [x] 4.1 在 `src/components/chat/token-stream.tsx` 将 `splitStreamingContent` 的切分单位改为「段落」，输出 `[{ text, startOffset }]`
- [x] 4.2 新增 `React.memo` 的 `StreamSegment`（内部渲染 `MarkdownRenderer`），key 使用段落起始字符偏移
- [x] 4.3 `TokenStream` 仅 map 渲染已完成段落 + 末尾纯文本 `pending`；确认「正在输入」尾行的纯文本展示行为不变
- [x] 4.4 验证：流式中新 token 仅挂载新段落，旧段落 React.memo 命中跳过（Profiler 无重渲染）

## 5. 代码高亮轻量化与缓存（D4）

- [x] 5.1 新增 `src/components/chat/code-block.tsx`，`React.memo` 于 `(language, value)`，封装高亮渲染
- [x] 5.2 将 `markdown-renderer.tsx` 的 `code` 组件改用 `CodeBlock`；导入从 `Prism` 切换为 `PrismLight`
- [x] 5.3 显式 `registerLanguage` 精选集合（ts/js/jsx/tsx/python/go/rust/java/c/cpp/bash/json/yaml/sql/html/css/markdown），未知语言回退普通 `<pre>`
- [x] 5.4 验证：`npm run build` 产物中代码高亮语言定义体积下降；含代码块的长回答重复渲染不再重跑高亮

## 6. 消息块稳定标识与对象复用（D5）

- [x] 6.1 在 `src/components/chat/message-list.tsx` 用 `useRef<Map<blockId, MessageBlock>>` 缓存块对象
- [x] 6.2 `groupMessages` 输出时，按底层消息 id 序列 + 内容签名复用既有块引用；内容变化时产生新引用
- [x] 6.3 会话切换 / 卸载时清空缓存 Map
- [x] 6.4 验证：发送消息后 `invalidateQueries` 重拉取，Profiler 中已完成 `ChatMessage` 不重渲染

## 7. 长会话虚拟滚动（D6）

- [x] 7.1 在 `src/components/chat/message-list.tsx` 引入 `useVirtualizer`（动态高度 + `measureElement`），渲染 `blocks`
- [x] 7.2 将流式尾部 `TokenStream` 作为虚拟列表最后一个 item 参与，保证滚动到底与渲染一致
- [x] 7.3 适配现有 `isNearBottom` / `scheduleScrollToBottom` 逻辑至虚拟滚动容器（`scrollHeight`/`scrollTop` 判定保持有效）
- [x] 7.4 验证：数百条消息会话滚动流畅，DOM 节点数有界；流式输出时自动滚到底行为正常

## 8. 整体验证

- [x] 8.1 `npm run lint` 与 `npm run build` 均通过
- [x] 8.2 手动验证：长回答（含多段、代码块）流式输出不卡顿；长会话切换/刷新无长时间卡死
- [x] 8.3 更新 `openspec` 变更状态并准备归档（`/opsx:archive` 前置检查）
