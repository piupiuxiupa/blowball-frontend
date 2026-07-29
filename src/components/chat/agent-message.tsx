import { memo } from 'react';
import type { AgentStatus } from '@/stores/ui-store';
import { UserBubble } from './user-bubble';
import { BareConfucius } from './bare-confucius';
import { CollapsibleSubAgent } from './collapsible-sub-agent';

export interface AgentMessageProps {
  agent: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: string[];
  status: AgentStatus;
  // 是否为仍在输出的活动流式段（running/tool_call）；持久化块与已结束段为 false。
  isLive?: boolean;
}

// 按 role / agent 名统一派发：持久化块与流式段归约为同一形状后共用此分发器（design D3）。
//   role === 'user'           → UserBubble（右侧气泡）
//   agent === 'Confucius'     → BareConfucius（全宽裸 Markdown）
//   else (Chongzhi | Liang)   → CollapsibleSubAgent（默认折叠气泡）
// 主/子判定键于固定 agent 枚举字面量；拓扑日后变化只需改这一处谓词。
export const AgentMessage = memo(function AgentMessage(props: AgentMessageProps) {
  if (props.role === 'user') {
    return <UserBubble content={props.content} />;
  }

  if (props.agent === 'Confucius') {
    return (
      <BareConfucius
        content={props.content}
        reasoning={props.reasoning}
        toolCalls={props.toolCalls}
        status={props.status}
        isLive={!!props.isLive}
      />
    );
  }

  return (
    <CollapsibleSubAgent
      agent={props.agent}
      content={props.content}
      reasoning={props.reasoning ?? ''}
      toolCalls={props.toolCalls}
      status={props.status}
      isLive={!!props.isLive}
    />
  );
});
