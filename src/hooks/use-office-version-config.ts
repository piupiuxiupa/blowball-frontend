import { useQuery } from '@tanstack/react-query';
import { fetchOfficeVersionConfig } from '@/lib/onlyoffice';

// useOfficeVersionConfig fetches the backend-built + signed VIEW-ONLY OnlyOffice
// editor config for a historical office version.
//
// 与 useOfficeConfig 的区别：版本不可变，无 nonce（后端按 versionId 派生稳定
// document.key，DocumentServer 缓存转换结果），因此 query key 仅 [path, versionId]、
// staleTime 无限（同一版本的签名配置不变）。
export function useOfficeVersionConfig(path: string, versionId: string) {
  return useQuery({
    queryKey: ['office-version-config', path, versionId],
    queryFn: () => fetchOfficeVersionConfig(path, versionId),
    enabled: !!path && !!versionId,
    staleTime: Infinity,
    retry: false,
  });
}
