import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SessionContextUsageResponse } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { DRAFT_SESSION_ID } from '@/stores/ui-store';

// 普通会话的持久化上下文快照（api 分区）：表示最近已落库 turn 的最后一轮
// provider 观测，不能由流式 token 或当前模型目录推算。
export const contextUsageQueryKey = (sessionId: string | null) =>
  ['context-usage', sessionId] as const;

export function fetchContextUsage(sessionId: string): Promise<SessionContextUsageResponse> {
  return apiGet<SessionContextUsageResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/context-usage`
  );
}

export function useContextUsage(sessionId: string | null) {
  const enabled = !!sessionId && sessionId !== DRAFT_SESSION_ID;
  return useQuery({
    queryKey: contextUsageQueryKey(sessionId),
    enabled,
    queryFn: () => fetchContextUsage(sessionId as string),
    // 不触碰 Monaco 内容，可像会话详情一样在聚焦时刷新（全局默认关闭）。
    refetchOnWindowFocus: true,
  });
}

const RECONCILE_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 300;

// done 与 usage 落库不原子：以刚完成的 run id 做有界新鲜度核对，不能把第一次
// 读到的上一轮当成最终值。每次只写服务端真实响应；失败/耗尽后由打开或聚焦恢复。
export async function reconcileContextUsage(sessionId: string, runId: string): Promise<void> {
  const queryKey = contextUsageQueryKey(sessionId);
  if (!runId) {
    await queryClient.invalidateQueries({ queryKey });
    return;
  }

  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt++) {
    try {
      const snapshot = await queryClient.fetchQuery<SessionContextUsageResponse>({
        queryKey,
        queryFn: () => fetchContextUsage(sessionId),
        staleTime: 0,
        retry: false,
      });
      if (snapshot.available && snapshot.run_id === runId) return;
    } catch {
      // usage 是 best-effort 观测，读取失败不打断 turn 收尾，也不伪造目标快照。
    }
    if (attempt < RECONCILE_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RECONCILE_DELAY_MS));
    }
  }
}
