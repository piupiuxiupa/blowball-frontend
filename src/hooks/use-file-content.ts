import { useQuery } from '@tanstack/react-query';
import { apiGet, getApiBase, getToken } from '@/lib/api';
import type { FileContentResponse } from '@/lib/api';

// opts.enabled lets callers opt out of the text-content fetch for files that
// are rendered another way (e.g. office files via OnlyOffice's binary download
// endpoint, where /content would just 400 with BINARY_FILE). Defaults to
// "fetch whenever a path is set".
export function useFileContent(path: string | null, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? !!path;
  return useQuery({
    queryKey: ['file-content', path],
    queryFn: async () => {
      if (!path) return null;
      try {
        return await apiGet<FileContentResponse>(
          `/api/v1/workspace/files/${encodeURIComponent(path)}/content`
        );
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
