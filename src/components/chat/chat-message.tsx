import { memo } from 'react';
import type { AgentStatus } from '@/stores/ui-store';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import type { ArtifactInfo } from '@/lib/api';
import { AgentMessage } from './agent-message';
import { ArtifactChips } from './artifact-chips';
import { ArtifactLinkContext } from './markdown-renderer';

interface ChatMessageProps {
  sessionId?: string | null;
  block: {
    id: string;
    agent: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    timeline: MessageTimelineItem[];
    agentInstanceId?: string;
    isError?: boolean;
    msgTime?: string;
    // turn-artifacts：块所属 turn 的产物列表（链接钉版上下文）与 chips 宿主标记。
    turnArtifacts?: ArtifactInfo[];
    renderChips?: boolean;
  };
  navigationHighlighted?: boolean;
}

// 持久化消息块适配器：把 MessageBlock 归约为 AgentMessage 的统一形状后按 agent 派发。
// 持久化块恒为已完成态（status idle / error，isLive false），与流式段共用同一组展示组件。
// turn-artifacts：块级注入链接钉版上下文（产物列表 + 块时间）；chips 只随宿主块渲染。
export const ChatMessage = memo(function ChatMessage({
  sessionId,
  block,
  navigationHighlighted,
}: ChatMessageProps) {
  const status: AgentStatus = block.isError ? 'error' : 'idle';
  return (
    <ArtifactLinkContext.Provider value={{ artifacts: block.turnArtifacts, msgTime: block.msgTime }}>
      <AgentMessage
        agent={block.agent}
        role={block.role}
        content={block.content}
        reasoning={block.reasoning}
        timeline={block.timeline}
        agentInstanceId={block.agentInstanceId || undefined}
        sessionId={sessionId}
        status={status}
        isLive={false}
        blockId={block.id}
        navigationHighlighted={navigationHighlighted}
      />
      {block.renderChips && block.turnArtifacts?.length ? (
        <ArtifactChips artifacts={block.turnArtifacts} msgTime={block.msgTime} />
      ) : null}
    </ArtifactLinkContext.Provider>
  );
});
