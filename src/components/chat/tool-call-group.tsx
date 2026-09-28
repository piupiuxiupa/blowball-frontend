import { memo, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, Wrench } from 'lucide-react';
import type { AgentStatus } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { ToolCallBubble, parseToolCall } from './tool-call-bubble';

interface ToolCallGroupProps {
  toolCalls: string[];
  status: AgentStatus;
  isLive: boolean;
}

// 工具记录折叠组：一个块/段内的全部 tool_call + tool_result 汇总为一张卡，默认只显示
// 一行摘要。此前逐条堆叠 ToolCallBubble，Confucius 连续 invoke_* 时每条新记录都会把
// 已输出的正文顶出视口；折叠后卡片高度恒定，流式追加工具记录不再推动正文，用户聚焦
// 在 Markdown 正文上。点击摘要行才渲染 ToolCallBubble 列表（tool_call 与 tool_result
// 共用此数组，摘要按是否为结果型分别计数）。任一记录出错（status===1）整卡标红提示，
// 但仍保持默认折叠——与 ToolCallBubble 的错误卡样式对齐，详情需点击展开。
export const ToolCallGroup = memo(function ToolCallGroup({
  toolCalls,
  status,
  isLive,
}: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);

  // 以数组引用为依赖而非逐项重解析：ui-store 仅在 push 新记录时新建 toolCalls 数组，
  // token 流式期间引用稳定，避免每帧 flush 对大结果串重复 JSON.parse。
  const items = useMemo(() => toolCalls.map((raw) => parseToolCall(raw)), [toolCalls]);
  const callCount = items.filter((it) => !it.isResult).length;
  const resultCount = items.length - callCount;
  const hasError = items.some((it) => it.isError);
  // 段一旦收到 tool_call 即置 tool_call 态直至 agent_end（见 ui-store pushSegmentToolCall），
  // 折叠行上的 spinner 与子 Agent 触发行/浮窗头部的「调用工具」指示同源。
  const isCalling = isLive && status === 'tool_call';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border backdrop-blur-md',
        hasError ? 'border-red-200 bg-red-50/60' : 'border-white/50 bg-white/40',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-black/[0.03]',
          expanded && (hasError ? 'border-b border-red-200/70' : 'border-b border-white/40'),
        )}
      >
        <Wrench className="h-3 w-3 shrink-0" />
        <span className={cn(hasError && 'text-destructive')}>
          {callCount > 0 ? `工具调用 · ${callCount} 次` : `工具结果 · ${resultCount} 条`}
        </span>
        {hasError && <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />}
        {isCalling && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-1.5 px-2 py-2">
          {toolCalls.map((tool, idx) => (
            <ToolCallBubble key={idx} raw={tool} />
          ))}
        </div>
      )}
    </div>
  );
});
