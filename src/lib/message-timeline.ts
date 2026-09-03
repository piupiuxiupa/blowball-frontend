// 单个 agent 段内的可渲染事件序列。文本片段会在相邻 token 间合并；
// tool_call 作为独立节点保留；tool_result 通过 tool_call_id 合并回对应调用节点。
export type MessageTimelineItem =
  | { type: 'text'; content: string }
  | { type: 'tool'; content: string; result?: string; toolCallId?: string };

export interface TimelineToolOptions {
  kind?: 'call' | 'result';
  toolCallId?: string;
}

function readToolCallId(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.tool_call_id === 'string') return obj.tool_call_id;
    const output = obj.output;
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const id = (output as Record<string, unknown>).tool_call_id;
      if (typeof id === 'string') return id;
    }
  } catch {
    // 非 JSON 的历史记录没有可靠关联键，保留为独立卡。
  }
  return '';
}

export function attachTimelineToolResult(
  timeline: MessageTimelineItem[],
  result: string,
  toolCallId?: string,
): { timeline: MessageTimelineItem[]; matched: boolean } {
  const targetId = toolCallId || readToolCallId(result);
  if (!targetId) return { timeline, matched: false };

  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.type !== 'tool' || item.result !== undefined) continue;
    const callId = item.toolCallId || readToolCallId(item.content);
    if (callId !== targetId) continue;

    const next = timeline.slice();
    next[i] = { ...item, result };
    return { timeline: next, matched: true };
  }

  return { timeline, matched: false };
}

// 流式 store 需要保持不可变更新；这里返回新数组 / 新末节点，避免把旧段中的
// timeline 对象原地改写。无内容的 chunk 直接返回原引用，配合 rAF 节流使用。
export function appendTimelineText(
  timeline: MessageTimelineItem[],
  chunk: string,
): MessageTimelineItem[] {
  if (!chunk) return timeline;

  const last = timeline[timeline.length - 1];
  if (last?.type === 'text') {
    const next = timeline.slice();
    next[next.length - 1] = { type: 'text', content: last.content + chunk };
    return next;
  }

  return [...timeline, { type: 'text', content: chunk }];
}

export function appendTimelineTool(
  timeline: MessageTimelineItem[],
  content: string,
  options: TimelineToolOptions = {},
): MessageTimelineItem[] {
  if (!content) return timeline;

  if (options.kind === 'result') {
    const attached = attachTimelineToolResult(timeline, content, options.toolCallId);
    if (attached.matched) return attached.timeline;
  }

  return [
    ...timeline,
    { type: 'tool', content, toolCallId: options.kind === 'call' ? options.toolCallId : undefined },
  ];
}
