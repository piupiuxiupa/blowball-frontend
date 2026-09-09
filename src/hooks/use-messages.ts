import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SessionMessagesResponse } from '@/lib/api';
import { DRAFT_SESSION_ID } from '@/stores/ui-store';

const DEFAULT_PAGE_SIZE = 2000;

export function useMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['messages', sessionId],
    queryFn: async () => {
      if (!sessionId) return { messages: [] } as SessionMessagesResponse;

      const allMessages: NonNullable<SessionMessagesResponse['messages']> = [];
      let pageToken: string | undefined;

      do {
        const response = await apiGet<SessionMessagesResponse>(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
          {
            params: {
              page_size: DEFAULT_PAGE_SIZE,
              order: 'asc',
              // unique-subagent-message-placeholders：动态子 Agent 行收敛为
              // agent_start/end/error 生命周期标记，父 spawn_subagent 的重复
              // tool_result 行也被省略；被省略的正文/工具明细统一由
              // SubAgentRunTranscripts 面板按 run 懒加载（1.2.0 起的历史读模型），
              // full 模式会把同一份明细再渲染一遍。
              subagent_content: 'placeholder',
              ...(pageToken ? { page_token: pageToken } : {}),
            },
          }
        );
        if (response.messages) {
          allMessages.push(...response.messages);
        }
        pageToken = response.next_page_token;
      } while (pageToken);

      return { messages: allMessages } as SessionMessagesResponse;
    },
    // 排除草稿哨兵:draft 未落库,GET /sessions/draft/messages 只会 404;
    // 草稿态消息区由 ChatPanel 渲染空态,不走此查询。
    enabled: !!sessionId && sessionId !== DRAFT_SESSION_ID,
  });
}
