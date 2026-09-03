# add-user-message-navigation

## Why

长会话中用户消息与多段助手输出交替出现，用户想回看某个提问时只能凭记忆滚动。消息区需要一条低噪声的边框定位轨道，把每个用户回合映射为一个可点击刻度，并在长会话虚拟滚动下提供可靠的跳转定位。

## What Changes

- 在聊天消息区左边缘新增用户消息导航轨道；会话内少于 2 条用户消息时不显示。
- 每条用户消息对应一个等距刻度；悬停时邻近刻度形成宽度涟漪，并显示编号、时间与正文预览。
- 点击刻度跳转到虚拟列表中的对应用户消息，并短暂高亮该用户气泡。
- 轨道根据消息区视口 40% 线标记当前用户回合；用户滚动时同步更新。
- 轨道本身可在刻度超出高度时滚动，并隐藏滚动条以保持边框形态。
- 刻度按钮保留键盘焦点与 aria 语义；当前刻度使用 `aria-current` 标记。
- Out of scope：按助手消息定位、搜索/过滤消息、修改消息历史数据结构。

## Capabilities

### New Capabilities

- `chat-message-navigation`: 用户消息边框定位轨道的显示、当前态、预览、跳转与高亮行为。

### Modified Capabilities

（无——不改变消息分组、流式渲染、自动贴底与虚拟滚动本身的既有约束。）

## Impact

- `src/components/chat/message-list.tsx`: 从持久化消息块提取用户锚点、计算当前刻度、执行虚拟列表跳转与短暂高亮。
- `src/components/chat/message-navigation-rail.tsx`: 新增轨道 UI、悬停涟漪、预览卡与轨道内滚动。
- `src/components/chat/user-bubble.tsx` 及消息派发链路: 传递并渲染定位高亮。
- `src/index.css`: 隐藏轨道滚动条。
