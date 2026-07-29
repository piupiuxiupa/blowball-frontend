// 懒加载的 Monaco 查看器（由 code-viewer.tsx 经 React.lazy 拉起，或编辑态由
// file-renderer 直接渲染）。单个常驻 Editor 实例 + 切文件时切换 model，而非重挂载
// 编辑器（决策3）。import monaco-setup 触发 worker/语言注册副作用，因此 Monaco 整体
// 仅在此 chunk 内。
import { useEffect, useRef } from 'react';
import { monaco, getLanguageIdFromPath } from './monaco/monaco-setup';
import { useFileEditActions } from '@/hooks/use-file-edit';
import { useFileEditStore } from '@/stores/file-edit-store';

interface MonacoViewerProps {
  path: string;
  content: string;
  /**
   * 是否可编辑。false（默认）= 只读浏览；true = 可写，接入 dirty/保存（Ctrl+S）。
   * 兑现 text-file-viewer 的前向契约：翻转只读即编辑，骨架不变。
   */
  editable?: boolean;
}

// model URI 的 scheme：用 inmemory 避免与真实 file:// 冲突，path 用文件路径以便缓存复用。
function modelUriForPath(path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'inmemory', path: `/${path}` });
}

export function MonacoViewer({ path, content, editable = false }: MonacoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // 按 model 路径缓存 view state，切回文件时恢复光标/滚动（VSCode 级浏览体验）。
  const viewStatesRef = useRef<Map<string, monaco.editor.ICodeEditorViewState | null>>(new Map());

  const actions = useFileEditActions();

  // 用 ref 持有最新的 editable / path / save，供 mount-once 的 effect 与命令回调读取，
  // 避免在 editor 生命周期内反复 dispose/重注册。
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const pathRef = useRef(path);
  pathRef.current = path;
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    void actions.save();
  };

  // 1) 创建单个常驻 Editor 实例（仅挂载一次）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = monaco.editor.create(container, {
      readOnly: !editableRef.current,
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
    useFileEditStore.getState().setEditor(editor);

    // dirty 跟踪：可编辑时，本地值 ≠ 载入基线 → markDirty（task 3.1）。
    const contentSub = editor.onDidChangeModelContent(() => {
      if (!editableRef.current) return;
      const p = pathRef.current;
      const v = editor.getValue();
      const loaded = useFileEditStore.getState().loadedByPath[p];
      useFileEditStore.getState().markDirty(p, loaded !== undefined && v !== loaded);
    });

    // Ctrl+S 保存（仅编辑态生效）；命令在 editor 聚焦时触发（task 3.2）。
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (!editableRef.current) return;
      saveRef.current();
    });

    return () => {
      contentSub.dispose();
      editor.dispose();
      editorRef.current = null;
      if (useFileEditStore.getState().editor === editor) {
        useFileEditStore.getState().setEditor(null);
      }
    };
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
    } else {
      // 已有缓存 model：仅当「无未保存改动」时同步到最新内容。
      // dirty 时绝不覆盖——这正是决策3要修的隐性 bug：后台重取/缓存刷新不能抹掉本地输入。
      const isDirty = useFileEditStore.getState().dirtyByPath[path] === true;
      if (!isDirty && model.getValue() !== content) {
        model.setValue(content);
      }
    }

    editor.setModel(model);

    const saved = viewStatesRef.current.get(uri.path);
    if (saved) editor.restoreViewState(saved);
  }, [path, content]);

  // 3) readOnly 随 editable 变化同步。
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !editable });
  }, [editable]);

  // 4) 进入编辑态：首次记录载入基线（dirty 与并发校验的基准）。
  useEffect(() => {
    if (editable && path) {
      const st = useFileEditStore.getState();
      if (st.loadedByPath[path] === undefined) st.setLoaded(path, content);
    }
  }, [editable, path, content]);

  // 5) 载入基线变化（保存/丢弃/进入编辑）后重算 dirty，保证 toolbar/拦截读取一致。
  const loaded = useFileEditStore((s) => (path ? s.loadedByPath[path] : undefined));
  useEffect(() => {
    if (!editable) return;
    const editor = editorRef.current;
    if (!editor) return;
    const v = editor.getValue();
    useFileEditStore.getState().markDirty(path, loaded !== undefined && v !== loaded);
  }, [editable, path, loaded]);

  return <div ref={containerRef} className="h-full w-full" />;
}
