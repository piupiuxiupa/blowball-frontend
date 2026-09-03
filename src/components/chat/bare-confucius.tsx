import { memo } from 'react';
import { Lightbulb } from 'lucide-react';
import type { AgentStatus } from '@/stores/ui-store';
import { MarkdownRenderer } from './markdown-renderer';
import { OrderedMessageContent } from './ordered-message-content';
import type { MessageTimelineItem } from '@/lib/message-timeline';

interface BareConfuciusProps {
  reasoning?: string;
  timeline: MessageTimelineItem[];
  status: AgentStatus;
  isLive: boolean;
}

// 主编排 agent（Confucius）的输出：全宽裸 Markdown——无 glass 背景、无圆角气泡、
// 无头像、无名字标签，仿 ChatGPT/Claude.ai 主回答形态（design D4）。
// 活动段走增量 StreamingContent；已完成段 / 持久化块走全量 Markdown。
// 工具调用 / 结果不汇总到末尾，而是与正文片段按事件到达顺序内联渲染。
export const BareConfucius = memo(function BareConfucius({
  reasoning,
  timeline,
  status,
  isLive,
}: BareConfuciusProps) {
  return (
    <div className="space-y-2">
      {reasoning && (
        <details className="rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 backdrop-blur-md">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
            <Lightbulb className="h-3 w-3" />
            <span>思考过程</span>
          </summary>
          <div className="prose prose-sm max-w-none pt-1 text-muted-foreground">
            <MarkdownRenderer>{reasoning}</MarkdownRenderer>
          </div>
        </details>
      )}

      <OrderedMessageContent timeline={timeline} isLive={isLive} />

      {timeline.length === 0 && !reasoning && status === 'running' && (
        <div className="text-sm text-muted-foreground">思考中…</div>
      )}
    </div>
  );
});
