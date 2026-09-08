import { memo } from 'react';
import type { AgentStatus } from '@/stores/ui-store';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import { UserBubble } from './user-bubble';
import { BareConfucius } from './bare-confucius';
import { CollapsibleSubAgent } from './collapsible-sub-agent';

export interface AgentMessageProps {
  agent: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  timeline: MessageTimelineItem[];
  // 动态子 Agent 的稳定实例身份；有值且位于已落库会话时，展示 per-run 懒加载面板。
  agentInstanceId?: string;
  sessionId?: string | null;
  status: AgentStatus;
  // 是否为仍在输出的活动流式段（running/tool_call）；持久化块与已结束段为 false。
  isLive?: boolean;
  // 左侧用户消息导航轨道点击后的定位高亮，仅用户气泡消费。
  navigationHighlighted?: boolean;
}

// 按 role / agent 名统一派发：持久化块与流式段归约为同一形状后共用此分发器（design D3）。
//   role === 'user'           → UserBubble（右侧气泡）
//   agent === 'Confucius'     → BareConfucius（全宽裸 Markdown）
//   else (Chongzhi | Liang)   → CollapsibleSubAgent（默认折叠气泡）
// 主/子判定键于固定 agent 枚举字面量；拓扑日后变化只需改这一处谓词。
export const AgentMessage = memo(function AgentMessage(props: AgentMessageProps) {
  if (props.role === 'user') {
    return (
      <UserBubble content={props.content} isHighlighted={props.navigationHighlighted} />
    );
  }

  if (props.agent === 'Confucius') {
    return (
      <BareConfucius
        reasoning={props.reasoning}
        timeline={props.timeline}
        status={props.status}
        isLive={!!props.isLive}
      />
    );
  }

  return (
    <CollapsibleSubAgent
      agent={props.agent}
      reasoning={props.reasoning ?? ''}
      timeline={props.timeline}
      agentInstanceId={props.agentInstanceId}
      sessionId={props.sessionId}
      status={props.status}
      isLive={!!props.isLive}
    />
  );
});
