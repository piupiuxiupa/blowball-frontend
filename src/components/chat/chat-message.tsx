import { memo } from 'react';
import type { AgentStatus } from '@/stores/ui-store';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import { AgentMessage } from './agent-message';

interface ChatMessageProps {
  block: {
    id: string;
    agent: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    timeline: MessageTimelineItem[];
    isError?: boolean;
  };
  navigationHighlighted?: boolean;
}

// 持久化消息块适配器：把 MessageBlock 归约为 AgentMessage 的统一形状后按 agent 派发。
// 持久化块恒为已完成态（status idle / error，isLive false），与流式段共用同一组展示组件。
export const ChatMessage = memo(function ChatMessage({
  block,
  navigationHighlighted,
}: ChatMessageProps) {
  const status: AgentStatus = block.isError ? 'error' : 'idle';
  return (
    <AgentMessage
      agent={block.agent}
      role={block.role}
      content={block.content}
      reasoning={block.reasoning}
      timeline={block.timeline}
      status={status}
      isLive={false}
      navigationHighlighted={navigationHighlighted}
    />
  );
});
