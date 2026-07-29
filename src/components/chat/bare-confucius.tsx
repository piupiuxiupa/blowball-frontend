import { memo } from 'react';
import { Lightbulb } from 'lucide-react';
import type { AgentStatus } from '@/stores/ui-store';
import { MarkdownRenderer } from './markdown-renderer';
import { StreamingContent } from './streaming-content';
import { ToolCallBubble } from './tool-call-bubble';

interface BareConfuciusProps {
  content: string;
  reasoning?: string;
  toolCalls: string[];
  status: AgentStatus;
  isLive: boolean;
}

// 主编排 agent（Confucius）的输出：全宽裸 Markdown——无 glass 背景、无圆角气泡、
// 无头像、无名字标签，仿 ChatGPT/Claude.ai 主回答形态（design D4）。
// 活动段走增量 StreamingContent；已完成段 / 持久化块走全量 Markdown。
// 其 tool_call 仍以内联 ToolCallBubble 显示（含 invoke_*，按用户决定全部显示）。
export const BareConfucius = memo(function BareConfucius({
  content,
  reasoning,
  toolCalls,
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

      {content && <StreamingContent text={content} isLive={isLive} />}

      {toolCalls.length > 0 && (
        <div className="space-y-1.5">
          {toolCalls.map((tool, idx) => (
            <ToolCallBubble key={idx} raw={tool} />
          ))}
        </div>
      )}

      {!content && !reasoning && status === 'running' && (
        <div className="text-sm text-muted-foreground">思考中…</div>
      )}
    </div>
  );
});
