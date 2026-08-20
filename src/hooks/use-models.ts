import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { ModelsResponse } from '@/lib/api';

// 可选模型目录（per-request-model，api 分区 → apiGet）。目录极少变化,聚焦重取
// 沿用全局默认(关闭)即可。无目录部署时后端合成单条 legacy 条目——显式传参会被
// 400 拒绝,选择器据此隐藏（见 model-selector 的渲染条件）。
export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: () => apiGet<ModelsResponse>('/api/v1/models'),
  });
}
