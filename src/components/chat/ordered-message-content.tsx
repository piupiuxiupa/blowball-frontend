import { memo } from 'react';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import { StreamingContent } from './streaming-content';
import { PlanStatusPlaceholder } from './plan-status-placeholder';
import { ToolCallBubble } from './tool-call-bubble';

interface OrderedMessageContentProps {
  timeline: MessageTimelineItem[];
  isLive: boolean;
}

// agent 段内的事件序渲染器：文本片段与工具调用按到达顺序交替出现；
// tool_result 已在 timeline 中按 tool_call_id 合并进对应调用卡。
// 不包裹额外 div，让父级的 space-y-* 同时作用于文本块与工具卡。
// plan_updated 不再渲染完整计划卡——最新计划已外置到输入框上方的固定状态栏
// （PlanStatusBar），消息流内只留一行轻量占位，保持事件序语义而不抢视觉。
export const OrderedMessageContent = memo(function OrderedMessageContent({
  timeline,
  isLive,
}: OrderedMessageContentProps) {
  return (
    <>
      {timeline.map((item, index) => {
        if (item.type === 'text') {
          return <StreamingContent key={`text-${index}`} text={item.content} isLive={isLive} />;
        }
        if (item.type === 'plan') {
          return <PlanStatusPlaceholder key={`plan-${index}`} raw={item.content} />;
        }
        return <ToolCallBubble key={`tool-${index}`} raw={item.content} result={item.result} />;
      })}
    </>
  );
});
