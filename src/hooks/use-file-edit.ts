import { useWriteFileContent, fetchFileContent } from '@/hooks/use-file-content';
import { ApiRequestError } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';

// 保存结果：'saved' 已落盘；'cancelled' 用户在覆盖确认中取消；'noop' 无 dirty 不发 PUT；
// 'error' 保存出错（已弹提示）。
export type SaveOutcome = 'saved' | 'cancelled' | 'noop' | 'error';

// 把后端错误码翻译成中文提示（task 3.2 / spec 错误场景）。
function reportSaveError(err: unknown): void {
  if (err instanceof ApiRequestError) {
    if (err.code === 'BINARY_FILE') {
      alert('内容含非法字节，无法保存为文本');
    } else if (err.code === 'HTTP_413' || err.code.endsWith('413') || err.code === 'PAYLOAD_TOO_LARGE') {
      alert('文件过大，已超出服务端上限，请改用上传');
    } else {
      alert(`保存失败：${err.message}`);
    }
  } else {
    alert(`保存失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// 编辑动作编排。多个组件（MonacoViewer 的 Ctrl+S、工具条保存、dirty 拦截弹窗）各自
// 调用本 hook；它们共享 file-edit-store 的态（saving / dirty / notice），动作实现读取
// 时刻最新的 store 与 ui-store，因此彼此一致。
export function useFileEditActions() {
  const writeContent = useWriteFileContent();

  return {
    // 保存：无 dirty 跳过；否则保存前阻断式重取校验，远端已变 → 覆盖确认；最后 PUT /content。
    async save(): Promise<SaveOutcome> {
      const ui = useUIStore.getState();
      const edit = useFileEditStore.getState();
      const path = ui.activeFilePath;
      const editor = edit.editor;
      if (!path || !editor) return 'noop';
      const value = editor.getValue();
      const loaded = edit.loadedByPath[path];

      // 无 dirty：空操作，不发 PUT（spec「无改动时保存为空操作」）。
      if (loaded !== undefined && value === loaded) return 'noop';

      // 并发校验（design 决策2 / task 4.1）：阻断式重取，相对载入已变 → 覆盖确认。
      try {
        const fresh = await fetchFileContent(path);
        if (loaded !== undefined && fresh.content !== loaded) {
          if (!window.confirm('文件已被外部修改（可能由 Agent），是否覆盖？')) {
            return 'cancelled';
          }
        }
      } catch {
        // 校验读取失败（如瞬时网络）：降级直接尝试保存——后端本就是 last-writer-wins。
      }

      edit.setSaving(true);
      try {
        await writeContent.mutateAsync({ path, content: value });
        // 成功：推进载入基线到已存值、清 dirty、清外部变更提示。
        const now = useFileEditStore.getState();
        now.setLoaded(path, value);
        now.markDirty(path, false);
        now.setNotice(null);
        return 'saved';
      } catch (err) {
        reportSaveError(err);
        return 'error';
      } finally {
        useFileEditStore.getState().setSaving(false);
      }
    },

    // 丢弃本地改动：把 Monaco model 恢复到载入基线并清 dirty。
    discard(): void {
      const ui = useUIStore.getState();
      const edit = useFileEditStore.getState();
      const path = ui.activeFilePath;
      const editor = edit.editor;
      if (!path || !editor) return;
      const loaded = edit.loadedByPath[path];
      if (loaded !== undefined) {
        const model = editor.getModel();
        if (model && model.getValue() !== loaded) model.setValue(loaded);
      }
      edit.markDirty(path, false);
      edit.setNotice(null);
    },

    // 编辑态刷新：dirty 时先确认丢弃，然后从服务端拉真值写回 model + 基线。
    async refresh(): Promise<void> {
      const ui = useUIStore.getState();
      const edit = useFileEditStore.getState();
      const path = ui.activeFilePath;
      if (!path) return;
      if (edit.dirtyByPath[path] && !window.confirm('刷新将丢弃未保存的改动，是否继续？')) {
        return;
      }
      edit.setNotice(null);
      try {
        const fresh = await fetchFileContent(path);
        const editor = useFileEditStore.getState().editor;
        if (editor) {
          const model = editor.getModel();
          if (model && model.getValue() !== fresh.content) model.setValue(fresh.content);
        }
        const now = useFileEditStore.getState();
        now.setLoaded(path, fresh.content);
        now.markDirty(path, false);
        queryClient.setQueryData(['file-content', path], fresh);
      } catch (err) {
        alert(`刷新失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

// 受守卫的活动文件切换：当前活动文件有未保存改动时，不直接切换，而是把目标记入
// pendingSwitch，交由 DirtyGuardDialog 处理（task 4.4）。无 dirty 则正常切换。
export function selectFile(path: string): void {
  const ui = useUIStore.getState();
  const edit = useFileEditStore.getState();
  const active = ui.activeFilePath;
  if (active && edit.dirtyByPath[active] && path !== active) {
    edit.setPendingSwitch(path);
    return;
  }
  ui.setActiveFile(path);
}

// 关闭查看（清空活动文件）时同样走 dirty 拦截：用 null 目标。
export function closeFile(): void {
  const ui = useUIStore.getState();
  const edit = useFileEditStore.getState();
  const active = ui.activeFilePath;
  if (active && edit.dirtyByPath[active]) {
    edit.setPendingSwitch(null);
    return;
  }
  ui.setActiveFile(null);
}
