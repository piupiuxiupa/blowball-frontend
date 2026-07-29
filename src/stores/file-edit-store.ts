import { create } from 'zustand';
import type * as Monaco from 'monaco-editor/editor/editor.api';

// 文件编辑态（dirty / 载入基线 / 保存中 / 外部变更提示 / 切走拦截）。
//
// 为什么放 store 而非组件局部 state：保存、丢弃、切走拦截、工具条按钮分属不同组件
// （MonacoViewer、file-toolbar、dirty-guard-dialog、file-tree），需要一个共享来源。
// 按文件 path 记录，切换活动文件后各文件保留各自的载入基线/dirty（与 Monaco model
// 缓存对齐）。fileViewMode 本身粘在 ui-store；这里只管「内容编辑」相关态。
interface FileEditState {
  // 载入基线：进入编辑时从服务端拉到的内容。dirty 判定（本地值 ≠ 载入值）与并发
  // 校验（保存前重取 ≠ 载入值）都相对它（见 design 决策2）。后端 /content 无 update_time，
  // 故以内容本身作近似乐观锁的基准。
  loadedByPath: Record<string, string>;
  // dirty 标记，由 Monaco onChange 推动。
  dirtyByPath: Record<string, boolean>;
  saving: boolean;
  // 非阻塞提示：编辑态聚焦时探测到远端外部变更（design Resolved Decisions 2）。
  notice: string | null;
  // 切走拦截：用户尝试切换到的目标。undefined = 无拦截；null = 待关闭查看；
  // string = 待切换到的目标路径。由 DirtyGuardDialog 处理（task 4.4）。
  pendingSwitch: string | null | undefined;
  // 当前活跃 Monaco editor（编辑态由 MonacoViewer 注册）。保存/丢弃时读其 getValue/setValue。
  editor: Monaco.editor.IStandaloneCodeEditor | null;

  setLoaded: (path: string, content: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
  clearPath: (path: string) => void;
  // 清除某路径及其子树下所有文件的载入基线/dirty（删除/移动目录后回收）。
  clearUnder: (prefix: string) => void;
  setSaving: (saving: boolean) => void;
  setNotice: (notice: string | null) => void;
  setPendingSwitch: (path: string | null | undefined) => void;
  setEditor: (editor: Monaco.editor.IStandaloneCodeEditor | null) => void;
}

export const useFileEditStore = create<FileEditState>((set) => ({
  loadedByPath: {},
  dirtyByPath: {},
  saving: false,
  notice: null,
  pendingSwitch: undefined,
  editor: null,

  setLoaded: (path, content) =>
    set((state) => ({ loadedByPath: { ...state.loadedByPath, [path]: content } })),
  markDirty: (path, dirty) =>
    set((state) => ({
      dirtyByPath: dirty
        ? { ...state.dirtyByPath, [path]: true }
        : Object.fromEntries(Object.entries(state.dirtyByPath).filter(([k]) => k !== path)),
    })),
  clearPath: (path) =>
    set((state) => {
      const loaded = { ...state.loadedByPath };
      const dirty = { ...state.dirtyByPath };
      delete loaded[path];
      delete dirty[path];
      return { loadedByPath: loaded, dirtyByPath: dirty };
    }),
  clearUnder: (prefix) =>
    set((state) => {
      const under = (k: string) => k === prefix || k.startsWith(`${prefix}/`);
      return {
        loadedByPath: Object.fromEntries(
          Object.entries(state.loadedByPath).filter(([k]) => !under(k))
        ),
        dirtyByPath: Object.fromEntries(
          Object.entries(state.dirtyByPath).filter(([k]) => !under(k))
        ),
      };
    }),
  setSaving: (saving) => set({ saving }),
  setNotice: (notice) => set({ notice }),
  setPendingSwitch: (path) => set({ pendingSwitch: path }),
  setEditor: (editor) => set({ editor }),
}));
