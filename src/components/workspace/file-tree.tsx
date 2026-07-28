import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Folder, ChevronRight, ChevronDown, File, Trash2, Pencil, Loader2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace, useDeleteFile, useRenameFile } from '@/hooks/use-workspace';
import { useUIStore } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadButton } from './upload-button';
import type { FileEntry } from '@/lib/api';

// joinPath builds the workspace-relative path for an entry from its parent
// prefix and basename. The backend's catch-all resolves these verbatim, so a
// nested file `reports/notes.md` must be addressed as "reports/notes.md" — not
// just "notes.md" (which would hit a different file at the workspace root).
function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function FileTree() {
  const { files, isLoading, error } = useWorkspace();
  const queryClient = useQueryClient();
  const showHiddenFiles = useUIStore((s) => s.showHiddenFiles);
  const toggleShowHiddenFiles = useUIStore((s) => s.toggleShowHiddenFiles);
  // 失效 ['workspace'] 会命中根目录与所有已展开子目录的查询（前缀匹配），
  // 一次刷新拉到全部最新文件；任一在途时刷新图标旋转。
  const isFetching = useIsFetching({ queryKey: ['workspace'] }) > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center justify-between border-b border-white/50 bg-white/20 px-3 backdrop-blur-sm">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">工作空间</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleShowHiddenFiles}
            title={showHiddenFiles ? '隐藏隐藏文件' : '显示隐藏文件'}
            aria-label={showHiddenFiles ? '隐藏隐藏文件' : '显示隐藏文件'}
            aria-pressed={showHiddenFiles}
          >
            {showHiddenFiles ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['workspace'] })}
            title="刷新"
            aria-label="刷新工作空间"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
          <UploadButton />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          )}

          {error && <div className="p-2 text-xs text-destructive">加载文件失败</div>}

          {!isLoading && files.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground">暂无文件</div>
          )}

          <FileNodeList entries={files} parentPath="" />
        </div>
      </ScrollArea>
    </div>
  );
}

function FileNodeList({ entries, parentPath }: { entries: FileEntry[]; parentPath: string }) {
  // 隐藏文件的过滤由接口侧 include_hidden 控制（见 useWorkspace），此处直接渲染全部返回项。
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => (
        <FileNode key={entry.name} entry={entry} parentPath={parentPath} />
      ))}
    </div>
  );
}

function FileNode({ entry, parentPath }: { entry: FileEntry; parentPath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { activeFilePath, setActiveFile } = useUIStore();
  const deleteFile = useDeleteFile();
  const renameFile = useRenameFile();
  const fullPath = joinPath(parentPath, entry.name);
  const isActive = activeFilePath === fullPath;
  const isDeleting = deleteFile.isPending;
  const isRenaming = renameFile.isPending;
  const isDir = entry.type === 'dir';
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDelete = async (e: React.MouseEvent) => {
    // Stop propagation so the click doesn't also toggle/expand the row.
    e.stopPropagation();
    const msg = isDir
      ? `确定删除目录「${entry.name}」及其所有内容吗？此操作不可撤销。`
      : `确定删除文件「${entry.name}」吗？此操作不可撤销。`;
    if (!window.confirm(msg)) return;
    try {
      await deleteFile.mutateAsync(fullPath);
    } catch (err) {
      alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const submitRename = async (newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && trimmed !== entry.name) {
      const newPath = joinPath(parentPath, trimmed);
      try {
        await renameFile.mutateAsync({ oldPath: fullPath, newPath });
      } catch (err) {
        alert(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitRename(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    void submitRename(e.target.value);
  };

  const actionButtons = !isEditing && (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-8 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
        onClick={startEditing}
        disabled={isDeleting || isRenaming}
        title={isDir ? '重命名目录' : '重命名文件'}
        aria-label={`${isDir ? '重命名目录' : '重命名文件'} ${entry.name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        onClick={handleDelete}
        disabled={isDeleting || isRenaming}
        title={isDir ? '删除目录' : '删除文件'}
        aria-label={`${isDir ? '删除目录' : '删除文件'} ${entry.name}`}
      >
        {isDeleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </>
  );

  const nameContent = isEditing ? (
    <Input
      ref={inputRef}
      defaultValue={entry.name}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={isRenaming}
      className="h-6 px-1 py-0 text-sm"
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    <span className="truncate">{entry.name}</span>
  );

  if (isDir) {
    return (
      <div>
        <div className="group relative flex items-center">
          <button
            onClick={() => !isEditing && setExpanded(!expanded)}
            disabled={isDeleting || isEditing}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 pr-14 text-left text-sm transition-all hover:bg-foreground/[0.05]"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            {nameContent}
          </button>
          {actionButtons}
        </div>

        {expanded && (
          <div className="ml-5 border-l border-white/40 pl-1">
            <DirectoryChildren path={fullPath} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group relative flex items-center">
      <button
        onClick={() => setActiveFile(fullPath)}
        disabled={isDeleting || isEditing}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 pr-14 text-left text-sm transition-all',
          isActive
            ? 'bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_rgba(255,159,10,0.35)]'
            : 'hover:bg-foreground/[0.05]',
          isDeleting && 'opacity-50'
        )}
      >
        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
        {nameContent}
      </button>
      {actionButtons}
    </div>
  );
}

function DirectoryChildren({ path }: { path: string }) {
  const { files, isLoading } = useWorkspace(path);

  if (isLoading) {
    return (
      <div className="space-y-1 p-1">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    );
  }

  return <FileNodeList entries={files} parentPath={path} />;
}
