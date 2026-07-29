import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { useFileEditActions } from '@/hooks/use-file-edit';

// 切走/关闭拦截（task 4.4）：当前活动文件有未保存改动时，selectFile/closeFile 不直接
// 切换，而是把目标记入 pendingSwitch，由此弹窗要求用户选择「保存 / 不保存 / 取消」。
// pendingSwitch === null 表示「关闭查看」；否则为即将切换到的目标路径。
export function DirtyGuardDialog() {
  const pendingSwitch = useFileEditStore((s) => s.pendingSwitch);
  const setPendingSwitch = useFileEditStore((s) => s.setPendingSwitch);
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  const setActiveFile = useUIStore((s) => s.setActiveFile);
  const actions = useFileEditActions();
  const [busy, setBusy] = useState(false);

  // undefined = 无拦截。仅在确有未保存改动时弹窗（selectFile/closeFile 已确保只在
  // dirty 时置 pendingSwitch，这里双保险）。
  if (pendingSwitch === undefined) return null;
  const dirty = activeFilePath
    ? useFileEditStore.getState().dirtyByPath[activeFilePath] === true
    : false;
  if (!dirty) return null;

  const targetLabel = pendingSwitch === null ? '关闭当前文件' : `切换到「${pendingSwitch}」`;

  const finish = (next: string | null) => {
    setPendingSwitch(undefined);
    setActiveFile(next);
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const out = await actions.save();
      if (out === 'saved') finish(pendingSwitch);
      // error / cancelled：留在当前文件，关闭弹窗让用户重试。
      else setPendingSwitch(undefined);
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = () => {
    actions.discard();
    finish(pendingSwitch);
  };

  const onCancel = () => setPendingSwitch(undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-xl border border-white/60 bg-background p-5 shadow-xl">
        <div className="text-sm font-medium text-foreground">未保存的改动</div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          「{activeFilePath}」有未保存的改动。{targetLabel}前如何处理？
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={busy}>
            不保存
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
