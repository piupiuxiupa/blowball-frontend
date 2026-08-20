import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from '@/lib/api';
import type { SessionListResponse, CreateSessionResponse, UpdateTitleResponse } from '@/lib/api';
import { useUIStore } from '@/stores/ui-store';

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      apiPatch<UpdateTitleResponse>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        body: { title },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useSessions() {
  const queryClient = useQueryClient();
  const { setActiveSession } = useUIStore();

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiGet<SessionListResponse>('/api/v1/sessions'),
    // 单独开启聚焦重取（覆盖全局默认 false）：全局关闭是为保护 Monaco 未保存编辑
    // （见 query-client.ts 注释），而会话列表不碰文件内容。这也是 detach 后回到页面
    // 感知 turn 结束（generating 徽标消失）的主通道（turn-detach-resume）。
    refetchOnWindowFocus: true,
  });

  const createMutation = useMutation({
    mutationFn: () => apiPost<CreateSessionResponse>('/api/v1/sessions'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setActiveSession(data.session_id);
    },
  });

  return {
    sessions: sessionsQuery.data?.sessions ?? [],
    isLoading: sessionsQuery.isLoading,
    error: sessionsQuery.error,
    // 懒创建：真实创建只由「草稿会话首条消息」的 create-first 编排调用
    // （message-input），「+」按钮不再触发。mutateAsync resolve 时 onSuccess 已
    // 把活动会话切到新 id，调用方随即以该 id 发送。
    createSessionAsync: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}

// Delete is a dedicated hook so each SessionItem owns its own mutation instance
// (per-item pending state) without re-subscribing the whole list.
//
// A 404 is treated as "already gone": the backend returns NOT_FOUND when the
// session is missing or belongs to another user (its existence is never
// disclosed), which also covers the case where it was deleted from another tab
// since this list was fetched. In that case we still purge local state so the
// row does not linger in the sidebar, pinned as active, with stale streaming
// buffers — only genuine failures (500/network) leave the entry in place.
export function useDeleteSession() {
  const queryClient = useQueryClient();

  const purgeSession = (sessionId: string) => {
    queryClient.removeQueries({ queryKey: ['messages', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });

    const ui = useUIStore.getState();
    if (ui.activeSessionId === sessionId) {
      ui.setActiveSession(null);
      ui.clearStreamingSegments(sessionId);
    }
  };

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiDelete<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`),
    onSuccess: (_data, sessionId) => purgeSession(sessionId),
    onError: (err, sessionId) => {
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        purgeSession(sessionId);
      }
    },
  });
}
