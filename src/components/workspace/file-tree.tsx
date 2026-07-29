import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  File,
  Trash2,
  Pencil,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useWorkspace,
  useDeleteFile,
  useRenameFile,
  useMoveNode,
  useCreateNode,
  reportCreateError,
} from '@/hooks/use-workspace';
import { selectFile } from '@/hooks/use-file-edit';
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

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

// 规整「新建」输入名：trim、去首尾斜杠；拒绝空、含反斜杠、`.`/`..` 段或空段（`//`）。
// 后端仍会校验越界（→ 403），此处只做轻量本地校验以提供即时反馈与更好的默认体验。
function normalizeCreateName(raw: string): string | null {
  const name = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!name || name.includes('\\')) return null;
  if (name.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return name;
}

// HTML5 DnD 携带的路径数据 mime（同时写 text/plain 兜底）。
const PATH_MIME = 'application/x-blowball-path';

export function FileTree() {
  const { files, isLoading, error } = useWorkspace();
  const queryClient = useQueryClient();
  const showHiddenFiles = useUIStore((s) => s.showHiddenFiles);
  const toggleShowHiddenFiles = useUIStore((s) => s.toggleShowHiddenFiles);
  const moveNode = useMoveNode();
  const [rootDragOver, setRootDragOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'directory' | null>(null);
  // 失效 ['workspace'] 会命中根目录与所有已展开子目录的查询（前缀匹配），
  // 一次刷新拉到全部最新文件；任一在途时刷新图标旋转。
  const isFetching = useIsFetching({ queryKey: ['workspace'] }) > 0;

  // 拖到根区域：new_path = basename（移到工作区根）。
  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRootDragOver(false);
    const src = e.dataTransfer.getData(PATH_MIME) || e.dataTransfer.getData('text/plain');
    if (!src) return;
    await moveNode(src, basename(src));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative z-50 flex h-11 items-center justify-between border-b border-white/50 bg-white/20 px-3 backdrop-blur-sm">
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
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setMenuOpen((v) => !v)}
              title="新建"
              aria-label="新建文件或目录"
              aria-expanded={menuOpen}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {menuOpen && (
              <>
                {/* 点击任意外部区域关闭菜单（透明全屏捕获层，z-40 在菜单之下）。 */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="glass-strong absolute right-0 top-7 z-50 min-w-[8rem] rounded-md p-1 shadow-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      setCreateType('file');
                      setMenuOpen(false);
                    }}
                  >
                    <File className="h-3.5 w-3.5" /> 新建文件
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      setCreateType('directory');
                      setMenuOpen(false);
                    }}
                  >
                    <Folder className="h-3.5 w-3.5" /> 新建文件夹
                  </button>
                </div>
              </>
            )}
          </div>
          <UploadButton />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* 根区域作为 drop 目标（移到根）；命中子目录时其 onDrop 会 stopPropagation，不再冒泡到这里。 */}
        <div
          className={cn('p-2', rootDragOver && 'rounded-md ring-2 ring-inset ring-primary/40')}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PATH_MIME) || e.dataTransfer.types.includes('text/plain')) {
              e.preventDefault();
              setRootDragOver(true);
            }
          }}
          onDragLeave={() => setRootDragOver(false)}
          onDrop={handleRootDrop}
        >
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          )}

          {error && <div className="p-2 text-xs text-destructive">加载文件失败</div>}

          {!isLoading && files.length === 0 && !createType && (
            <div className="p-2 text-xs text-muted-foreground">暂无文件</div>
          )}

          {createType && (
            <CreateRow
              type={createType}
              onDone={() => setCreateType(null)}
              onCancel={() => setCreateType(null)}
            />
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
  const [dragOver, setDragOver] = useState(false);
  const { activeFilePath } = useUIStore();
  const deleteFile = useDeleteFile();
  const renameFile = useRenameFile();
  const moveNode = useMoveNode();
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

  // 拖拽源：拖起节点（文件/目录），把全路径写入 dataTransfer。
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(PATH_MIME, fullPath);
    e.dataTransfer.setData('text/plain', fullPath);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 目录作为 drop 目标：拖入即移动进该目录（new_path = 目录/basename）。
  const handleDirDragOver = (e: React.DragEvent) => {
    if (!isDir || isEditing) return;
    if (e.dataTransfer.types.includes(PATH_MIME) || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  };

  const handleDirDrop = async (e: React.DragEvent) => {
    if (!isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const src = e.dataTransfer.getData(PATH_MIME) || e.dataTransfer.getData('text/plain');
    if (!src) return;
    await moveNode(src, joinPath(fullPath, basename(src)));
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
        <div
          className={cn(
            'group relative flex items-center rounded-lg',
            dragOver && 'ring-2 ring-inset ring-primary/50 bg-primary/5'
          )}
          draggable={!isEditing}
          onDragStart={handleDragStart}
          onDragOver={handleDirDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDirDrop}
        >
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
    <div
      className="group relative flex items-center"
      draggable={!isEditing}
      onDragStart={handleDragStart}
      // 文件行非 drop 目标：阻止冒泡到根区域，避免悬停文件时根高亮/误落到根（拖放仅认目录与根）。
      onDragOver={(e) => e.stopPropagation()}
    >
      <button
        // 经 selectFile（带 dirty 拦截）而非直接 setActiveFile：当前文件有未保存改动时
        // 会先弹保存/不保存/取消（task 4.4）。
        onClick={() => selectFile(fullPath)}
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

// 树顶内联「新建」输入行：选好类型后出现一行带图标的输入框，回车创建、Esc 取消、
// 失焦提交（与 FileNode 行内重命名一致）。失败时保持输入行以便改名重试。
// 创建于工作空间根目录；输入可含 `/` 做嵌套路径，后端自动建中间父目录。
function CreateRow({
  type,
  onDone,
  onCancel,
}: {
  type: 'file' | 'directory';
  onDone: () => void;
  onCancel: () => void;
}) {
  const createNode = useCreateNode();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async (raw: string) => {
    if (createNode.isPending) return; // 防止重复提交
    const name = normalizeCreateName(raw);
    if (!name) {
      onCancel();
      return;
    }
    try {
      await createNode.mutateAsync({ path: name, type });
      // 文件：打开它（经 selectFile，带 dirty 拦截）；目录：仅刷新（列表已失效）。
      if (type === 'file') selectFile(name);
      onDone();
    } catch (err) {
      reportCreateError(err, name);
      // 保持输入行：重新聚焦并选中文本，便于改名重试。
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      {type === 'file' ? (
        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <Input
        ref={inputRef}
        placeholder={type === 'file' ? '文件名（可用 / 分层）' : '目录名（可用 / 分层）'}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => void submit(e.target.value)}
        className="h-6 px-1 py-0 text-sm"
      />
      {createNode.isPending && (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
