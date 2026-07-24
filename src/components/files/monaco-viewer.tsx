// 懒加载的 Monaco 查看器（由 code-viewer.tsx 经 React.lazy 拉起）。
// 单个常驻 Editor 实例 + 切文件时切换 model，而非重挂载编辑器（决策3）。
// import monaco-setup 触发 worker/语言注册副作用，因此 Monaco 整体仅在此 chunk 内。
import { useEffect, useRef } from 'react';
import { monaco, getLanguageIdFromPath } from './monaco/monaco-setup';

interface MonacoViewerProps {
  path: string;
  content: string;
  /**
   * 只读开关，由单一来源驱动（见 code-viewer.tsx 的 readOnly 调用处）。
   * 当前恒为 true；未来「编辑 + 保存」只需翻转此值 + 接入保存数据流，组件骨架不变。
   */
  readOnly?: boolean;
}

// model URI 的 scheme：用 inmemory 避免与真实 file:// 冲突，path 用文件路径以便缓存复用。
function modelUriForPath(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'inmemory', path: `/${path}` });
}

export function MonacoViewer({ path, content, readOnly = true }: MonacoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // 按 model 路径缓存 view state，切回文件时恢复光标/滚动（VSCode 级浏览体验）。
  const viewStatesRef = useRef<Map<string, monaco.editor.ICodeEditorViewState | null>>(new Map());

  // 1) 创建单个常驻 Editor 实例（仅挂载一次）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      readOnly,
      theme: 'vs', // 内置浅色主题，对齐现有 Prism oneLight
      minimap: { enabled: true },
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'on',
      fontSize: 13,
      scrollBeyondLastLine: false,
      automaticLayout: true, // 容器尺寸变化时自动重排
      tabSize: 2,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      fixedOverflowWidgets: true, // 查找/悬浮部件不被父级 overflow 裁剪
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // readOnly 仅取初始值；后续变更由下方独立 effect 同步（单一来源驱动）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 切文件 / 内容更新：按路径复用或创建 model，setModel 而非重挂载。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // 切走前保存当前 model 的 view state，切回时恢复。
    const currentModel = editor.getModel();
    if (currentModel) {
      viewStatesRef.current.set(currentModel.uri.path, editor.saveViewState());
    }

    const languageId = getLanguageIdFromPath(path);
    const uri = modelUriForPath(path);

    let model = monaco.editor.getModel(uri);
    if (!model) {
      // 首次打开该文件：创建并以路径为 key 缓存，切回零拷贝、状态保留。
      model = monaco.editor.createModel(content, languageId, uri);
    } else if (model.getValue() !== content) {
      // 内容已变化（如 react-query 重取）：原地更新，避免重建 model。
      model.setValue(content);
    }

    editor.setModel(model);

    const saved = viewStatesRef.current.get(uri.path);
    if (saved) editor.restoreViewState(saved);
  }, [path, content]);

  // 3) readOnly 变化时同步。
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div ref={containerRef} className="h-full w-full" />;
}
