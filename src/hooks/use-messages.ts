import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SessionMessagesResponse } from '@/lib/api';
import { DRAFT_SESSION_ID } from '@/stores/ui-store';

const DEFAULT_PAGE_SIZE = 100;

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
