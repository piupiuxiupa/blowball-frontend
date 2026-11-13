import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostAgent,
  type ScheduledResourceGetResponse,
  type ScheduledResourcePublishResponse,
  type ScheduledSessionMessagesResponse,
  type ScheduledTask,
  type ScheduledTaskCreate,
  type ScheduledTaskListResponse,
  type ScheduledTaskPatch,
  type ScheduledTaskRunListResponse,
} from '@/lib/api';
import {
  buildEnabledPatch,
  isRunActive,
  SCHEDULED_TASK_PAGE_SIZE,
} from '@/lib/scheduled-task';

const TASKS_KEY = ['scheduled-tasks'] as const;
const RUNS_KEY = 'scheduled-task-runs';
const RESOURCES_KEY = 'scheduled-task-resources';
const SESSION_MESSAGES_KEY = 'scheduled-session-messages';
const TASK_POLL_MS = 10_000;
const RUN_POLL_MS = 3_000;

export function useScheduledTasks(enabled: boolean, offset: number) {
  return useQuery({
    queryKey: [...TASKS_KEY, offset],
    queryFn: () =>
      apiGet<ScheduledTaskListResponse>('/api/v1/scheduled-tasks', {
        params: { limit: SCHEDULED_TASK_PAGE_SIZE, offset },
      }),
    enabled,
    // 弹窗内的表单草稿与查询数据分离；刷新只更新服务端快照，不重建表单。
    refetchInterval: enabled ? TASK_POLL_MS : false,
  });
}

export function useScheduledTaskRuns(taskId: string, enabled: boolean, offset: number) {
  return useQuery({
    queryKey: [RUNS_KEY, taskId, offset],
    queryFn: () =>
      apiGet<ScheduledTaskRunListResponse>(
        `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs`,
        { params: { limit: SCHEDULED_TASK_PAGE_SIZE, offset } }
      ),
    enabled: enabled && !!taskId,
    // 由 React Query 管理间隔：离开历史视图 enabled=false 即停，全部终局也不再轮询。
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => isRunActive(run.status)) ? RUN_POLL_MS : false,
  });
}

export function useCreateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduledTaskCreate) =>
      apiPost<ScheduledTask>('/api/v1/scheduled-tasks', { body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUpdateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: ScheduledTaskPatch }) =>
      apiPatch<ScheduledTask>(`/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
        body: patch,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useSetScheduledTaskEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, enabled }: { taskId: string; enabled: boolean }) =>
      apiPatch<ScheduledTask>(`/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
        body: buildEnabledPatch(enabled),
      }),
    onSuccess: (_task, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      // 启停会阻止尚未跨过 startup fence 的 occurrence，历史也必须重新读取。
      void queryClient.invalidateQueries({ queryKey: [RUNS_KEY, taskId] });
    },
  });
}

export function useDeleteScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiDelete<void>(`/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`),
    onSuccess: (_data, taskId) => {
      queryClient.removeQueries({ queryKey: [RUNS_KEY, taskId] });
      queryClient.removeQueries({ queryKey: [RESOURCES_KEY, taskId] });
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}

// 任务执行会话的历史读：与 useMessages 同一读模型（分页拼接 + placeholder 子代理），
// 但走专用 scheduled-sessions 端点，不复用 ['messages'] 缓存。poll=true 时跟随运行中的
// occurrence（增量持久化的 closed-event 批次会陆续可见）。
export function useScheduledSessionMessages(sessionId: string, enabled: boolean, poll = false) {
  return useQuery({
    queryKey: [SESSION_MESSAGES_KEY, sessionId],
    enabled: enabled && !!sessionId,
    refetchInterval: enabled && poll ? RUN_POLL_MS : false,
    queryFn: async () => {
      const allMessages: NonNullable<ScheduledSessionMessagesResponse['messages']> = [];
      let pageToken: string | undefined;
      do {
        const response = await apiGet<ScheduledSessionMessagesResponse>(
          `/api/v1/scheduled-sessions/${encodeURIComponent(sessionId)}/messages`,
          {
            params: {
              page_size: 2000,
              order: 'asc',
              subagent_content: 'placeholder',
              ...(pageToken ? { page_token: pageToken } : {}),
            },
          }
        );
        if (response.messages) allMessages.push(...response.messages);
        pageToken = response.next_page_token;
      } while (pageToken);
      return { messages: allMessages } as ScheduledSessionMessagesResponse;
    },
  });
}

// 任务会话的运行取消：与普通 turn 取消同为 agent 分区的 TurnCancel 处理器
// （split 部署必须走 agent base），legacy_interactive 的 run 仍用普通会话路径。
// 响应只是受理回执（run_id/status），终局仍由历史轮询呈现。
export function useCancelScheduledRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, runId, legacy }: { sessionId: string; runId: string; legacy: boolean }) =>
      legacy
        ? apiPostAgent<{ run_id?: string; status?: string }>(
            `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(runId)}/cancel`
          )
        : apiPostAgent<{ run_id?: string; status?: string }>(
            `/api/v1/scheduled-sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/cancel`
          ),
    onSuccess: () => {
      // 取消只改变未来终局，不精确失效某一页：按前缀整体失效历史查询。
      void queryClient.invalidateQueries({ queryKey: [RUNS_KEY] });
    },
  });
}

export function useScheduledTaskResources(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: [RESOURCES_KEY, taskId],
    enabled: enabled && !!taskId,
    queryFn: () =>
      apiGet<ScheduledResourceGetResponse>(
        `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/resources`
      ),
  });
}

export function usePublishScheduledTaskResources() {
  const queryClient = useQueryClient();
  return useMutation({
    // request_id 由调用方铸造并随重试复用（发布幂等键），网络层重试不会发布两次。
    mutationFn: ({
      taskId,
      requestId,
      expectedDraftRevision,
    }: {
      taskId: string;
      requestId: string;
      expectedDraftRevision?: number;
    }) =>
      apiPost<ScheduledResourcePublishResponse>(
        `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/resources/publish`,
        {
          body: {
            request_id: requestId,
            ...(expectedDraftRevision !== undefined ? { expected_draft_revision: expectedDraftRevision } : {}),
          },
        }
      ),
    onSuccess: (_data, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: [RESOURCES_KEY, taskId] });
    },
  });
}
