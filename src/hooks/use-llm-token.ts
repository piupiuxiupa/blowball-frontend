import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPut } from '@/lib/api';
import type { LLMTokenPutRequest, LLMTokenStatus } from '@/lib/api';

export const LLM_TOKEN_QUERY_KEY = ['llm-token'] as const;

interface UseLLMTokenOptions {
  enabled?: boolean;
}

// 用户级模型网关 Token（api 分区）。状态只在打开设置弹窗/写入后变化，
// 成功写入直接采用接口返回的掩码，避免再次请求造成状态闪动。
export function useLLMToken({ enabled = true }: UseLLMTokenOptions = {}) {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: LLM_TOKEN_QUERY_KEY,
    queryFn: () => apiGet<LLMTokenStatus>('/api/v1/me/llm-token'),
    enabled,
  });

  const saveMutation = useMutation({
    mutationFn: (request: LLMTokenPutRequest) =>
      apiPut<LLMTokenStatus>('/api/v1/me/llm-token', { body: request }),
    onSuccess: (status) => queryClient.setQueryData(LLM_TOKEN_QUERY_KEY, status),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<LLMTokenStatus>('/api/v1/me/llm-token'),
    onSuccess: (status) => queryClient.setQueryData(LLM_TOKEN_QUERY_KEY, status),
  });

  return {
    status: statusQuery.data,
    isStatusLoading: statusQuery.isLoading,
    statusError: statusQuery.error,
    saveToken: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
    resetSaveError: saveMutation.reset,
    deleteToken: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.error,
    resetDeleteError: deleteMutation.reset,
  };
}
