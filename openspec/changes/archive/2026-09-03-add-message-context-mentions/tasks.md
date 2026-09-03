# add-message-context-mentions — Tasks

## 1. 序列化/解析 lib（design D3/D4）

- [x] 1.1 新建 `src/lib/additional-context.ts`：附加项类型（`{kind: 'file'|'dir'|'skill'|'mcp', path?, name?, server?}`）与 `serializeAdditionalContext`——`./` 前缀、属性转义（`& < "`）、固定 section 顺序、空 section 省略、三类全空返回 null、去重
- [x] 1.2 同文件实现 `parseAdditionalContext(content)`：仅识别开头（允许前导空白）且结构完整合法的块，返回 `{items, rest}` 或 null；反转义；属性与 section 顺序不敏感
- [x] 1.3 用临时 node 脚本验证 round-trip（含特殊字符文件名、部分/全部 section 缺省、中间位置 XML 不被剥离），验证后删除脚本

## 2. 输入区 chips 条（design D1/D8）

- [x] 2.1 `message-input.tsx` 增加 chips 本地 state 与 chips 条 UI：四类图标区分、× 移除、插入时去重
- [x] 2.2 `handleSubmit` 接入序列化：`content = serialize() + 正文`；请求级失败时 chips 与文本一同恢复（扩展现有 isError 恢复 effect）

## 3. ContextPicker 组件（design D2/D9）

- [x] 3.1 新建 picker 组件骨架：以初始分组（files / skills+tools）参数化，glass 弹层样式、点击外部关闭
- [x] 3.2 文件分组：空查询浏览模式（`useWorkspace` + 目录进入）、输入防抖搜索（`useWorkspaceSearch`）、父目录路径展示、`truncated` 提示沿用侧边栏口径；点击条目回调附加并摘除触发串
- [x] 3.3 skills+tools 分组：`useSkills` / `useMcpTools` 分组列表，tool 行展示 `name · server` 与 description 截断；点击回调附加（tool 携带 server）

## 4. 触发检测与键盘（design D7）

- [x] 4.1 caret 触发扫描：`@`/`/` 仅行首或空白后生效、查询串提取、`isComposing` 防护、选中后从 textarea 摘除触发串与查询
- [x] 4.2 弹层键盘语义：`↑`/`↓` 导航、`Enter` 选中（阻止冒泡不发送）、`Esc`/失焦关闭；弹层关闭时 Enter 发送/Shift+Enter 换行零回归

## 5. 常驻按钮

- [x] 5.1 输入区新增「技能」「工具」按钮，分别以 skills+tools 初始分组打开 picker（busy 禁用态与输入框一致）

## 6. 输入区 drop 目标（design D5）

- [x] 6.1 输入区外层容器识别 `application/x-blowball-path` 拖入：`dragover` 仅对该 mime `preventDefault` + ring 高亮（`ring-primary/40`），drop 读取路径附加为文件/目录 chip；不加 `text/plain` 兜底，OS 文件拖入不拦截

## 7. 侧边栏 hover「+」附加（design D6）

- [x] 7.1 `FileNode` 行内新增附加按钮：沿用 group-hover 绝对定位模式（调整既有 `right-8`/`right-0.5` 与 `pr-14` 内边距），文件与目录行均提供，点击附加不触发行点击
- [x] 7.2 `SearchRow` 同样提供附加按钮（文件与目录行）

## 8. 历史渲染剥离（design D10）

- [x] 8.1 `UserBubble` 上游接入 `parseAdditionalContext`：合法块渲染只读 chips 区（文件/目录 chip 点击 `setActiveFile` 预览）+ 余下正文 Markdown；无块/不合法原样渲染，零回归

## 9. 验证（无测试框架：lint + 浏览器手测）

- [x] 9.1 `npm run lint` 通过
- [x] 9.2 `npm run dev` 按 spec 场景逐条手测：序列化（三类全有/部分省略/全空/特殊字符转义/去重）、三入口附加、chips 移除与失败保留、词中 `@` 不触发、弹层内 Enter 不发送、Esc 复原、历史剥离与旧消息兼容、乐观↔落库一致（拼音 IME 下重复触发类场景）
- [x] 9.3 与后端按 design D3 逐条对齐格式（`./` 前缀、空 section、属性顺序、转义），确认标题生成管道是否剥离 XML
