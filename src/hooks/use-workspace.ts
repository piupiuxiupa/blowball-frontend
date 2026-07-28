import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPut, apiUpload, ApiRequestError } from '@/lib/api';
import type { FileListResponse, UploadResponse, RenameResponse } from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';

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

export function useRenameFile() {
  const queryClient = useQueryClient();

  const syncRenamed = (oldPath: string, newPath: string) => {
    queryClient.removeQueries({ queryKey: ['file-content', oldPath] });
    queryClient.invalidateQueries({ queryKey: ['workspace'] });

    const ui = useUIStore.getState();
    const active = ui.activeFilePath;
    if (!active) return;

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
    mutationFn: ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      apiPut<RenameResponse>(`/api/v1/workspace/files/${encodeURIComponent(oldPath)}`, {
        body: { new_path: newPath },
      }),
    onSuccess: (data) => syncRenamed(data.old_path, data.new_path),
    onError: (err, { oldPath, newPath }) => {
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        syncRenamed(oldPath, newPath);
      }
    },
  });
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
