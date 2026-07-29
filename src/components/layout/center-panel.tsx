import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { useFileEditActions } from '@/hooks/use-file-edit';
import { fetchFileContent } from '@/hooks/use-file-content';
import { canEdit } from '@/lib/file-type';
import { FileRenderer } from '@/components/files/file-renderer';
import { FileToolbar } from '@/components/files/file-toolbar';
import { DirtyGuardDialog } from '@/components/files/dirty-guard-dialog';

export function CenterPanel() {
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  const fileViewMode = useUIStore((s) => s.fileViewMode);
  const queryClient = useQueryClient();
  const actions = useFileEditActions();
  const notice = useFileEditStore((s) => s.notice);
  const setNotice = useFileEditStore((s) => s.setNotice);

  // refreshKey 并入二进制查看器（图片/PDF 缓存破坏、Office 重挂载）；文本内容靠下方
  // query 失效重取（Monaco 监听 content 变化原地 setValue，无需重挂载）。
  const [refreshKey, setRefreshKey] = useState(0);
  const editable = !!activeFilePath && fileViewMode === 'edit' && canEdit(activeFilePath);
  const isRefreshing = useIsFetching({ queryKey: ['file-content', activeFilePath] }) > 0;

  const handleRefresh = async () => {
    if (!activeFilePath) return;
    // 编辑态由 actions.refresh 处理（dirty 确认 + 拉真值写回 model）；查看态直接失效重取。
    if (editable) {
      await actions.refresh();
    } else {
      queryClient.invalidateQueries({ queryKey: ['file-content', activeFilePath] });
    }
    setRefreshKey((k) => k + 1);
  };

  // 编辑态窗口聚焦静默重取：远端自载入后已变 → 非阻塞提示，SHALL NOT 自动覆盖（task 4.2）。
  useEffect(() => {
    if (!editable || !activeFilePath) return;
    const onFocus = async () => {
      try {
        const fresh = await fetchFileContent(activeFilePath);
        const loaded = useFileEditStore.getState().loadedByPath[activeFilePath];
        if (loaded !== undefined && fresh.content !== loaded) {
          useFileEditStore.getState().setNotice(
            '文件已被外部修改（可能由 Agent）。保存前将再次校验。'
          );
        }
      } catch {
        // 探测失败不影响编辑，忽略。
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [editable, activeFilePath]);

  return (
    <div className="flex h-full flex-col">
      <FileToolbar onRefresh={() => void handleRefresh()} isRefreshing={isRefreshing} />

      {notice && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-300/40 bg-amber-50/80 px-4 py-1.5 text-xs text-amber-800 backdrop-blur-sm">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-200/60"
            aria-label="关闭提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <FileRenderer refreshKey={refreshKey} />
      </div>

      <DirtyGuardDialog />
    </div>
  );
}
