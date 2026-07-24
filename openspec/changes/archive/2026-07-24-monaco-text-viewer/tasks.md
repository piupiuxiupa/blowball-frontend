# Tasks

## 1. 依赖与最小验证 (Spike)

- [x] 1.1 安装 `monaco-editor`，确认其版本与 Vite 6 / React 19 兼容
- [x] 1.2 最小 spike：在临时入口挂一个只读 Monaco 渲染单个 `.ts` 文件，确认 Vite `?worker` 正常产出 worker 且高亮生效；验证后删除临时代码

## 2. Monaco 接入模块（自托管 + 精选语言）

- [x] 2.1 新建 Monaco 接入模块：经 Vite `?worker` 注册 `editor.worker`，并在 `self.MonacoEnvironment.getWorkerUrl` 中以 `import.meta.env.BASE_URL` 为前缀拼接 worker URL（遵循动态 `base`）
- [x] 2.2 按现有 Prism 别名表导入对应 `monaco-editor/esm/vs/basic-languages/*` contribution（typescript/javascript/python/yaml/shell/json/...），并建立「扩展名 → Monaco languageId」映射表（如 `yml→yaml`、`ts→typescript`、`py→python`、`sh→shell`）
- [x] 2.3 只读场景不注册 ts 语言服务 worker，验证仅 `editor.worker` 即可满足高亮（确认无 hover/补全不影响只读浏览）

## 3. 重写 CodeViewer（只读 Monaco）

- [x] 3.1 用 `React.lazy` 包裹 Monaco 查看器组件，懒加载期间用现有 `Skeleton` 占位
- [x] 3.2 维护单个常驻 `<Editor>` 实例：按文件路径构造 model URI，切文件时 `setModel` 复用/创建 model，而非重挂载编辑器
- [x] 3.3 配置只读 options（`readOnly`、`minimap`、`lineNumbers`、`folding`、`wordWrap`、字号），主题使用内置 `vs`
- [x] 3.4 将 `readOnly` 作为 prop 暴露（当前恒 `true`，来自单一来源），内容继续由 `useFileContent`（react-query）供给

## 4. 大文件守卫与分发集成

- [x] 4.1 定义大文件阈值常量 `MAX_MONACO_BYTES`（初定 1 MiB）
- [x] 4.2 内容字节数超阈值时回退渲染现有 `<CodeBlock>`（Prism 只读），未超阈值走 Monaco
- [x] 4.3 `file-renderer.tsx` 向 `CodeViewer` 传入文件 `path`（用于扩展名→语言解析与回退）

## 5. 验证与收尾

- [x] 5.1 手动验证：多语言文件高亮正确、未知扩展名回退纯文本不报错、连续切文件不重挂载、minimap/折叠/文件内查找可用
- [x] 5.2 验证大文件回退生效，以及懒加载（纯聊天会话不拉取 Monaco chunk，首打开文本文件才加载）
- [x] 5.3 验证非根 `base` 部署：用 `VITE_BASE_PATH` 本地模拟，确认 worker/资源不 404
- [x] 5.4 `npm run lint`（`tsc --noEmit`）与 `npm run build` 通过
