import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SubAgentRunDetail, SubAgentRunListResponse } from '@/lib/api';

// Run transcript 是按需展开的读模型；列表与详情都保持 5 分钟新鲜度，避免虚拟列表
// 滚动造成重复请求。active run 不会出现在终态列表/detail 中，实时输出仍走 SSE。
const STALE_TIME = 5 * 60 * 1000;

export function useSubAgentRuns(
  sessionId: string | null | undefined,
  agentInstanceId: string | null | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: ['subagent-runs', sessionId, agentInstanceId],
    enabled: !!sessionId && !!agentInstanceId && enabled,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiGet<SubAgentRunListResponse>(
        `/api/v1/sessions/${encodeURIComponent(sessionId as string)}/subagents/${encodeURIComponent(
          agentInstanceId as string
        )}/runs`
      ),
  });
}

export function useSubAgentRunDetail(
  sessionId: string | null | undefined,
  agentInstanceId: string | null | undefined,
  runId: string | null | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: ['subagent-run-detail', sessionId, agentInstanceId, runId],
    enabled: !!sessionId && !!agentInstanceId && !!runId && enabled,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiGet<SubAgentRunDetail>(
        `/api/v1/sessions/${encodeURIComponent(sessionId as string)}/subagents/${encodeURIComponent(
          agentInstanceId as string
        )}/runs/${encodeURIComponent(runId as string)}`
      ),
  });
}
