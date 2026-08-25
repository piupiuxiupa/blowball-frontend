import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, ApiRequestError } from '@/lib/api';
import type {
  FileListResponse,
  UploadResponse,
  RenameResponse,
  CreateNodeResponse,
  WorkspaceSearchResponse,
} from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';
import { useFileEditStore } from '@/stores/file-edit-store';

export function useWorkspace(path?: string) {
  const queryClient = useQueryClient();
  // 是否包含隐藏文件由文件树头部按钮控制，并入 queryKey 与请求参数：切换时会以新的
  // include_hidden 值重新拉取文件列表。后端默认 exclude 隐藏条目（名字以「.」开头），
  // 因此必须显式传 include_hidden=true 才能拿到，纯前端过滤无效。
  const includeHidden = useUIStore((s) => s.showHiddenFiles);

  const filesQuery = useQuery({
    queryKey: ['workspace', path ?? '', { hidden: includeHidden }],
    queryFn: () =>
      apiGet<FileListResponse>('/api/v1/workspace/files', {
        params: { path: path || undefined, include_hidden: includeHidden ? 'true' : 'false' },
      }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, subdir }: { file: File; subdir?: string }) => {
      return apiUpload<UploadResponse>('/api/v1/workspace/upload', {
        file,
        subdir,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });

  return {
    files: filesQuery.data?.files ?? [],
    isLoading: filesQuery.isLoading,
    error: filesQuery.error,
    uploadFile: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
  };
}

// 防抖值：输入停顿 delay 毫秒后才更新，避免每个键入字符都发出一次搜索请求。
function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// 工作区搜索（GET /api/v1/workspace/search，workspace-search 契约）：按条目名子串
// 递归匹配全工作区（后端复用 xizhi_find 引擎，正则元字符按字面处理；ignore_case
// 该端点默认 true，无需传参）。空 pattern 不发起请求（enabled=false）；防抖后的值
// 并入 queryKey，隐藏文件开关与文件树共用同一 ui-store 开关保持口径一致。
// 结果按路径字典序分页（head_limit 用后端默认 200），truncated=true 表示窗口外
// 还有匹配——MVP 不翻页，仅提示收窄关键词。
export function useWorkspaceSearch(pattern: string) {
  const includeHidden = useUIStore((s) => s.showHiddenFiles);
  const debounced = useDebouncedValue(pattern.trim());
  const enabled = debounced !== '';

  const searchQuery = useQuery({
    queryKey: ['workspace-search', debounced, { hidden: includeHidden }],
    queryFn: () =>
      apiGet<WorkspaceSearchResponse>('/api/v1/workspace/search', {
        params: { pattern: debounced, include_hidden: includeHidden ? 'true' : 'false' },
      }),
    enabled,
  });

  return {
    entries: searchQuery.data?.entries ?? [],
    total: searchQuery.data?.total ?? 0,
    truncated: searchQuery.data?.truncated ?? false,
    isSearching: enabled && searchQuery.isFetching,
    error: searchQuery.error,
  };
}

export function useRenameFile() {
  const queryClient = useQueryClient();

  const syncRenamed = (oldPath: string, newPath: string) => {
    queryClient.removeQueries({ queryKey: ['file-content', oldPath] });
    queryClient.invalidateQueries({ queryKey: ['workspace'] });
    // 回收编辑态（载入基线/dirty）：旧路径及其子树下的条目已失效。
    useFileEditStore.getState().clearUnder(oldPath);

    const ui = useUIStore.getState();
    const active = ui.activeFilePath;
    if (!active) return;

    // 前缀感知 activeFile 改写：被移动文件本身或位于被移动目录内 → 改写到新位置。
    let next: string | null = null;
    if (active === oldPath) {
      next = newPath;
    } else if (active.startsWith(`${oldPath}/`)) {
      next = `${newPath}${active.slice(oldPath.length)}`;
    }
    if (next !== null) {
      ui.setActiveFile(next);
    }
  };

  return useMutation({
    // overwrite 按需携带（task 6.1）：默认 false 保留 409 语义；覆盖确认后传 true。
    mutationFn: ({
      oldPath,
      newPath,
      overwrite,
    }: {
      oldPath: string;
      newPath: string;
      overwrite?: boolean;
    }) =>
      apiPut<RenameResponse>(`/api/v1/workspace/files/${encodeURIComponent(oldPath)}`, {
        body: { new_path: newPath, overwrite: overwrite === true },
      }),
    onSuccess: (data) => syncRenamed(data.old_path, data.new_path),
    onError: (err, { oldPath, newPath }) => {
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        syncRenamed(oldPath, newPath);
      }
    },
  });
}

// 客户端防环（task 6.4）：目标等于源、或目标位于源子树内 → 拒绝（后者会把目录移入自身，
// 破坏目录树）。同路径视为无操作。
export function isMoveIntoSelf(oldPath: string, newPath: string): boolean {
  return newPath.startsWith(`${oldPath}/`);
}

function reportMoveError(err: unknown, newPath: string): void {
  if (err instanceof ApiRequestError) {
    if (err.code === 'DEST_NOT_EMPTY') {
      alert('目标目录非空，不支持合并');
    } else {
      alert(`移动失败：${err.message}`);
    }
  } else {
    alert(`移动到「${newPath}」失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// 新建错误提示（task：新建文件/目录）：409 ALREADY_EXISTS → 已存在；其余按通用消息。
export function reportCreateError(err: unknown, path: string): void {
  if (err instanceof ApiRequestError) {
    if (err.code === 'ALREADY_EXISTS') {
      alert(`「${path}」已存在`);
    } else {
      alert(`创建失败：${err.message}`);
    }
  } else {
    alert(`创建「${path}」失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// 移动/拖入文件夹的编排（tasks 6.3 / 6.4）：客户端防环 → PUT rename →
// 409 ALREADY_EXISTS 弹覆盖确认后带 overwrite 重发；409 DEST_NOT_EMPTY 提示目录非空。
// 返回是否成功（用于拖拽视觉收尾）。
export function useMoveNode() {
  const rename = useRenameFile();
  return async (oldPath: string, newPath: string): Promise<boolean> => {
    if (newPath === oldPath) return false; // 拖回原处：无操作
    if (isMoveIntoSelf(oldPath, newPath)) {
      alert('不能将目录移入自身子目录');
      return false;
    }
    try {
      await rename.mutateAsync({ oldPath, newPath });
      return true;
    } catch (err) {
      // 目标已存在（后端：最终目的地是已存在文件，或对目录覆盖前的拒绝）。目录覆盖会
      // 单独以 DEST_NOT_EMPTY 返回（见 reportMoveError），故此处 ALREADY_EXISTS 视为文件覆盖。
      if (err instanceof ApiRequestError && err.code === 'ALREADY_EXISTS') {
        if (window.confirm(`目标「${newPath}」已存在，是否覆盖？`)) {
          try {
            await rename.mutateAsync({ oldPath, newPath, overwrite: true });
            return true;
          } catch (err2) {
            reportMoveError(err2, newPath);
            return false;
          }
        }
        return false;
      }
      reportMoveError(err, newPath);
      return false;
    }
  };
}

// Delete is a dedicated hook so each file/dir node owns its own mutation.
//
// A 404 is treated as "already gone": the entry vanished server-side between
// listing and click (e.g. an agent's xizhi tool restructured the directory),
// so we still refresh the tree and clear the active selection rather than
// leaving a stale row. Only genuine failures (403/500/network) leave the entry.
export function useDeleteFile() {
  const queryClient = useQueryClient();

  const syncDeleted = (path: string) => {
    queryClient.removeQueries({ queryKey: ['file-content', path] });
    queryClient.invalidateQueries({ queryKey: ['workspace'] });
    useFileEditStore.getState().clearUnder(path);

    const ui = useUIStore.getState();
    const active = ui.activeFilePath;
    if (active && (active === path || active.startsWith(`${path}/`))) {
      ui.setActiveFile(null);
    }
  };

  return useMutation({
    mutationFn: (path: string) =>
      apiDelete<void>(`/api/v1/workspace/files/${encodeURIComponent(path)}`),
    onSuccess: (_data, path) => syncDeleted(path),
    onError: (err, path) => {
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        syncDeleted(path);
      }
    },
  });
}

// Create an empty file or directory via POST .../files/{path}（strict create：
// leaf 已存在 → 409，父目录自动创建）。与 rename/delete 的整路径编码一致
// （encodeURIComponent，`/` → `%2F`）。仅失效列表查询；新建后是否打开文件由
// 调用方决定，保持 hook 与 UI 解耦。
export function useCreateNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, type }: { path: string; type: 'file' | 'directory' }) =>
      apiPost<CreateNodeResponse>(`/api/v1/workspace/files/${encodeURIComponent(path)}`, {
        body: { type },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}
