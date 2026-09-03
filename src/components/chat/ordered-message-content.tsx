import { memo } from 'react';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import { StreamingContent } from './streaming-content';
import { ToolCallBubble } from './tool-call-bubble';

interface OrderedMessageContentProps {
  timeline: MessageTimelineItem[];
  isLive: boolean;
}

// agent 段内的事件序渲染器：文本片段与工具调用按到达顺序交替出现；
// tool_result 已在 timeline 中按 tool_call_id 合并进对应调用卡。
// 不包裹额外 div，让父级的 space-y-* 同时作用于文本块与工具卡。
export const OrderedMessageContent = memo(function OrderedMessageContent({
  timeline,
  isLive,
}: OrderedMessageContentProps) {
  return (
    <>
      {timeline.map((item, index) =>
        item.type === 'text' ? (
          <StreamingContent key={`text-${index}`} text={item.content} isLive={isLive} />
        ) : (
          <ToolCallBubble key={`tool-${index}`} raw={item.content} result={item.result} />
        ),
      )}
    </>
  );
});
