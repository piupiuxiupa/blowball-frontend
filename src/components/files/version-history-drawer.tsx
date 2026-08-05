import { History, X, Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useFileVersions } from '@/hooks/use-file-versioning';
import { cn } from '@/lib/utils';

// 版本历史抽屉（编辑器右侧、可折叠）：按当前活动文件从 office-vers 拉取版本列表，
// 点击某版本 → 在主编辑区只读预览（设 previewVersionId）。恢复/退出在预览区头部。
export function VersionHistoryDrawer() {
  const open = useUIStore((s) => s.versionDrawerOpen);
  const setOpen = useUIStore((s) => s.setVersionDrawerOpen);
  const path = useUIStore((s) => s.activeFilePath);
  const previewVersionId = useUIStore((s) => s.previewVersionId);
  const setPreviewVersionId = useUIStore((s) => s.setPreviewVersionId);
  const { data, isLoading, error } = useFileVersions(open ? path : null);

  if (!open) return null;

  const versions = data?.versions ?? [];

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/50 bg-white/30 backdrop-blur-sm">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/50 px-3 text-sm font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          版本历史
        </span>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-0.5 hover:bg-black/5"
          aria-label="收起版本历史"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!path ? (
          <Empty text="未选择文件" />
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : error ? (
          <Empty text={`加载失败：${error instanceof Error ? error.message : String(error)}`} />
        ) : versions.length === 0 ? (
          <Empty text="暂无版本" hint="点击工具条「记录版本」创建第一个版本" />
        ) : (
          <ul className="divide-y divide-black/5">
            {versions.map((v) => {
              const active = v.versionId === previewVersionId;
              return (
                <li key={v.versionId}>
                  <button
                    onClick={() => setPreviewVersionId(active ? null : v.versionId)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-black/5',
                      active && 'bg-primary/10'
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate">{formatTime(v.lastModified)}</span>
                      {v.isLatest && (
                        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                          最新
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatSize(v.size)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
      <span>{text}</span>
      {hint && <span className="text-xs">{hint}</span>}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
