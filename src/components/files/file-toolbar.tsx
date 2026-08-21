import { RefreshCw, Save, EyeOff, Pencil, Loader2, Camera, History, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { useFileEditActions } from '@/hooks/use-file-edit';
import { useDownloadFile } from '@/hooks/use-file-content';
import { useSnapshotVersion } from '@/hooks/use-file-versioning';
import { isOfficeVersConfigured } from '@/lib/office-vers';
import { canEdit, getFileExtension, isOffice } from '@/lib/file-type';

interface FileToolbarProps {
  /** 刷新：由 center-panel 提供（负责 bump refreshKey + 失效文本缓存 + 编辑态重载）。 */
  onRefresh: () => void;
  isRefreshing: boolean;
}

// 中间面板统一文件工具条（design Resolved Decisions 1 / task 2.1）：收口此前三套
// ad-hoc 切换（office edit/view、html preview/source、新文本编辑）。承载文件名、
// [只读|编辑] 切换、保存、刷新。Office 经此开关切换；不可编辑类型（PDF/图片/二进制）
// 不展示编辑入口。
export function FileToolbar({ onRefresh, isRefreshing }: FileToolbarProps) {
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  const fileViewMode = useUIStore((s) => s.fileViewMode);
  const setFileViewMode = useUIStore((s) => s.setFileViewMode);
  const versionDrawerOpen = useUIStore((s) => s.versionDrawerOpen);
  const setVersionDrawerOpen = useUIStore((s) => s.setVersionDrawerOpen);
  const isDirty = useFileEditStore((s) =>
    activeFilePath ? s.dirtyByPath[activeFilePath] === true : false
  );
  const saving = useFileEditStore((s) => s.saving);
  const actions = useFileEditActions();
  const userId = useAuthStore((s) => s.userId);
  const snapshot = useSnapshotVersion();
  // 版本能力仅在已登录且 office-vers 已配置时可用。
  const versioningEnabled = !!userId && isOfficeVersConfigured();

  if (!activeFilePath) {
    return (
      <div className="flex h-11 shrink-0 items-center border-b border-white/50 bg-white/20 px-4 text-sm text-muted-foreground backdrop-blur-sm">
        未选择文件
      </div>
    );
  }

  const ext = getFileExtension(activeFilePath);
  const editable = canEdit(activeFilePath); // 文本可编辑（Monaco + PUT/content）
  const supportsMode = editable || isOffice(ext); // 文本编辑 或 Office（OnlyOffice）
  const inEdit = fileViewMode === 'edit';

  // 记录版本：文本 dirty 时拦截提示（Office 无 dirty，直取已落盘内容）。
  const handleSnapshot = async () => {
    if (!activeFilePath) return;
    if (canEdit(activeFilePath) && isDirty) {
      alert('当前有未保存改动，请先保存后再记录版本');
      return;
    }
    try {
      await snapshot.mutateAsync({ path: activeFilePath });
      alert('已记录版本');
    } catch (err) {
      alert(`记录版本失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 下载走 download 端点（token 走 query，浏览器原生 <a download>）。dirty 拦截与
  // 记录版本同理：端点下载的是已落盘内容，未保存时放行会拿到旧版文件。
  const downloadFile = useDownloadFile(activeFilePath);
  const handleDownload = () => {
    if (!activeFilePath) return;
    if (canEdit(activeFilePath) && isDirty) {
      alert('当前有未保存改动，请先保存后再下载');
      return;
    }
    downloadFile();
  };

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/50 bg-white/20 px-4 text-sm text-muted-foreground backdrop-blur-sm">
      <span className="truncate">{activeFilePath}</span>
      <div className="flex items-center gap-1">
        {supportsMode && (
          <div className="mr-1 flex items-center gap-0.5">
            <Button
              variant={!inEdit ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5"
              onClick={() => setFileViewMode('view')}
              title="只读"
            >
              <EyeOff className="h-3.5 w-3.5" />
              只读
            </Button>
            <Button
              variant={inEdit ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5"
              onClick={() => setFileViewMode('edit')}
              title="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
          </div>
        )}

        {editable && inEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5"
            onClick={() => void actions.save()}
            disabled={!isDirty || saving}
            title={isDirty ? '保存（Ctrl+S）' : '无改动'}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存
          </Button>
        )}

        {versioningEnabled && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5"
              onClick={() => void handleSnapshot()}
              disabled={snapshot.isPending}
              title="把当前文件记录为一个版本"
            >
              {snapshot.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              记录版本
            </Button>
            <Button
              variant={versionDrawerOpen ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5"
              onClick={() => setVersionDrawerOpen(!versionDrawerOpen)}
              title="版本历史"
            >
              <History className="h-3.5 w-3.5" />
              历史
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleDownload}
          title="下载文件"
          aria-label="下载文件"
        >
          <Download className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onRefresh}
          title="刷新"
          aria-label="刷新文件内容"
        >
          <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}
