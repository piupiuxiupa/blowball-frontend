import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, getApiBase, getToken } from '@/lib/api';
import type { FileContentResponse, FileContentWriteResponse } from '@/lib/api';

// opts.enabled lets callers opt out of the text-content fetch for files that
// are rendered another way (e.g. office files via OnlyOffice's binary download
// endpoint, where /content would just 400 with BINARY_FILE). Defaults to
// "fetch whenever a path is set".
//
// opts.staleTime / opts.refetchOnMount 透传给 react-query：编辑态调用方拉长
// staleTime、关闭 refetchOnMount，避免组件重挂载时重取覆盖 Monaco 中的本地改动
// （见 add-file-editing design 决策3）。
export function useFileContent(
  path: string | null,
  opts?: { enabled?: boolean; staleTime?: number; refetchOnMount?: boolean }
) {
  const enabled = opts?.enabled ?? !!path;
  return useQuery({
    queryKey: ['file-content', path],
    queryFn: async () => {
      if (!path) return null;
      try {
        return await fetchFileContent(path);
      } catch (error) {
        // If binary or directory, return a sentinel so caller can try download
        return { path, content: null, error: error as Error } as {
          path: string;
          content: null;
          error: Error;
        };
      }
    },
    enabled,
    staleTime: opts?.staleTime,
    refetchOnMount: opts?.refetchOnMount,
  });
}

// 直接 GET 文件内容（不经过 react-query 缓存）。保存前的并发校验与聚焦时的远端
// 变更探测都用它：必须读到服务端真值，而非可能过期的缓存（见 design 决策2）。
export async function fetchFileContent(path: string): Promise<FileContentResponse> {
  return apiGet<FileContentResponse>(
    `/api/v1/workspace/files/${encodeURIComponent(path)}/content`
  );
}

// PUT .../files/{path}/content：整文件原子写（create-or-replace）。
// 成功后乐观更新 ['file-content', path]（让查看态渲染反映已存值）并失效
// ['workspace']（刷新列表 size/update_time）——见 tasks 1.1 / 3.3。
export function useWriteFileContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      apiPut<FileContentWriteResponse>(
        `/api/v1/workspace/files/${encodeURIComponent(path)}/content`,
        { body: { content } }
      ),
    onSuccess: (data, { path, content }) => {
      queryClient.setQueryData(['file-content', path], {
        path,
        content,
        size: data.size,
      } satisfies FileContentResponse);
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

// getDownloadUrl returns a workspace file URL authenticated by the JWT in the
// query string. Use this for `<a download>` triggers and shared links.
export function getDownloadUrl(path: string): string {
  const token = getToken();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  return `${getApiBase()}/api/v1/workspace/files/download/${encodeURIComponent(path)}?${params.toString()}`;
}

// getPreviewUrl returns the same endpoint as getDownloadUrl but with inline=1,
// suitable for `<img src>`, PDF.js, and other browser-native preview elements.
// version（>0 时附加 v=N）用作缓存破坏：文件内容在服务端更新后，相同 URL 会被
// 浏览器/中间层命中缓存，bump version 才能强制重新拉取最新内容。首次加载省略。
export function getPreviewUrl(path: string, version?: number): string {
  const token = getToken();
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('inline', '1');
  if (version) params.set('v', String(version));
  return `${getApiBase()}/api/v1/workspace/files/download/${encodeURIComponent(path)}?${params.toString()}`;
}

export function useDownloadFile(path: string | null) {
  return () => {
    if (!path) return;
    const a = document.createElement('a');
    a.href = getDownloadUrl(path);
    a.download = path.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
}
