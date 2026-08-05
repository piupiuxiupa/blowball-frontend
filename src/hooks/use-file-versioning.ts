import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  downloadVersion,
  isOfficeVersConfigured,
  listVersions,
  uploadVersion,
  type VersionEntry,
  type VersionsResponse,
} from '@/lib/office-vers';
import { apiUpload } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useFileEditStore } from '@/stores/file-edit-store';
import { useWriteFileContent, getDownloadUrl } from '@/hooks/use-file-content';
import { canEdit } from '@/lib/file-type';

// 文件版本管理 hooks（office-vers 直连，{uuid} = 登录用户 id）。
// 设计见 add-file-versioning/design.md：office-vers 是工作区旁的「按需快照档案」，
// 版本仅由用户显式触发；预览只读、恢复把字节写回工作区（不新建版本）。

export type { VersionEntry, VersionsResponse };

// 当前用户 id（office-vers 的 {uuid}）。所有版本操作都以它命名空间。
function useUserId(): string | null {
  return useAuthStore((s) => s.userId);
}

// ── 记录版本（手动快照）─────────────────────────────────────────────────────
// 取当前工作文件已落盘字节（后端下载端点，类型无关）→ POST office-vers。
// dirty 拦截由调用方（工具条）在调 mutate 前完成；本 hook 只负责上传。
export function useSnapshotVersion() {
  const userId = useUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path }: { path: string }) => {
      if (!userId) throw new Error('未登录，无法记录版本');
      const res = await fetch(getDownloadUrl(path));
      if (!res.ok) throw new Error(`读取文件内容失败：${res.status}`);
      const blob = await res.blob();
      return uploadVersion(userId, path, blob);
    },
    onSuccess: (_data, { path }) => {
      // 刷新该文件的版本历史（若抽屉开着），让新版本立刻可见。
      queryClient.invalidateQueries({ queryKey: ['file-versions', userId, path] });
    },
  });
}

// ── 版本历史 ────────────────────────────────────────────────────────────────
// 404（从未快照）归一为空列表，调用方渲染空态。
export function useFileVersions(path: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['file-versions', userId, path],
    queryFn: () => listVersions(userId!, path!),
    enabled: !!userId && !!path && isOfficeVersConfigured(),
  });
}

// ── 指定版本字节（只读预览用）──────────────────────────────────────────────
// 版本字节不可变，staleTime 无限；卸载/切换由调用方 revokeObjectURL。
export function useVersionBlob(path: string | null, versionId: string | null) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['file-version-blob', userId, path, versionId],
    queryFn: () => downloadVersion(userId!, path!, versionId!),
    enabled: !!userId && !!path && !!versionId && isOfficeVersConfigured(),
    staleTime: Infinity,
    retry: false,
  });
}

// ── 恢复指定版本回工作区 ────────────────────────────────────────────────────
// 文本 → PUT /content；二进制/Office → multipart upload 覆盖同路径（父目录 + basename）。
// 不新建 office-vers 版本。成功后由调用方 bump refreshKey（Office 重挂载）并退出预览。
export type RestoreOutcome = 'success' | 'cancelled' | 'error';

export function useRestoreVersion() {
  const userId = useUserId();
  const writeContent = useWriteFileContent();
  const queryClient = useQueryClient();

  return async (path: string, versionId: string): Promise<RestoreOutcome> => {
    if (!userId) return 'error';
    if (!window.confirm('恢复此版本将覆盖当前工作文件内容，是否继续？')) return 'cancelled';
    try {
      const blob = await downloadVersion(userId, path, versionId);
      if (canEdit(path)) {
        // 文本：解码为字符串 → PUT /content（原子写）。
        const text = await blob.text();
        await writeContent.mutateAsync({ path, content: text });
        // 推进 Monaco 载入基线到恢复后内容、清 dirty（避免误判为未保存）。
        useFileEditStore.getState().setLoaded(path, text);
      } else {
        // 二进制 / Office：multipart upload 覆盖同路径。upload 以 {subdir=父目录, file basename}
        // 落到 父目录/basename = 原路径（依赖后端 upload 对同名覆盖；若后端为唯一名则需补端点）。
        const sep = path.lastIndexOf('/');
        const parent = sep >= 0 ? path.slice(0, sep) : '';
        const basename = sep >= 0 ? path.slice(sep + 1) : path;
        const file = new File([blob], basename);
        await apiUpload('/api/v1/workspace/upload', { file, subdir: parent || undefined });
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
        queryClient.removeQueries({ queryKey: ['file-content', path] });
      }
      useFileEditStore.getState().markDirty(path, false);
      return 'success';
    } catch (err) {
      alert(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
      return 'error';
    }
  };
}
