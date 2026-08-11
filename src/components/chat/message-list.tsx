import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMessages } from '@/hooks/use-messages';
import { useUIStore, type StreamingSegment } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChatMessage } from './chat-message';
import { AgentMessage } from './agent-message';
import type { Message } from '@/lib/api';

interface MessageBlock {
  id: string;
  agent: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: string[];
  isError?: boolean;
}

// 虚拟列表的单个条目：已完成消息块，或流式中的某个 agent 段（尾部按段映射为 N 个 item）。
type ListItem =
  | { kind: 'block'; block: MessageBlock }
  | { kind: 'streaming'; segment: StreamingSegment };

function groupMessages(messages: Message[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let current: MessageBlock | null = null;

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (current) blocks.push(current);
      current = null;
      blocks.push({
        id: `user-${msg.id}`,
        agent: 'user',
        role: 'user',
        content: msg.content,
        toolCalls: [],
      });
      continue;
    }

    if (msg.event_type === 'agent_start') {
      if (current) blocks.push(current);
      current = {
        id: `agent-${msg.id}`,
        agent: msg.agent,
        role: 'assistant',
        content: '',
        toolCalls: [],
      };
      continue;
    }

    if (msg.event_type === 'agent_end') {
      if (current) blocks.push(current);
      current = null;
      continue;
    }

    if (msg.event_type === 'agent_error') {
      if (current) {
        current.isError = true;
        current.content += `\n\n[错误] ${msg.content}`;
        // 不关闭块：对齐流式 setSegmentStatus（仅置 error，不结束段）。工具失败时后端
        // 会紧跟一条 tool_result（见 openapi SSEToolResult），若此处 push 并置 null，
        // 该 tool_result 会因无 current 挂载而丢失，历史里就看不到标红的工具结果气泡。
        // 块由后续 agent_end / agent_start / user 消息正常收尾。
      } else {
        blocks.push({
          id: `error-${msg.id}`,
          agent: msg.agent,
          role: 'assistant',
          content: `[错误] ${msg.content}`,
          toolCalls: [],
          isError: true,
        });
      }
      continue;
    }

    // tool_call = 工具调用（{tool_call_id,name,args}）；tool_result = 工具执行结果
    // （{tool_call_id,output:{result,status}}）。两者都作为独立气泡并入 toolCalls，
    // 由 ToolCallBubble.parseToolCall 区分形态，结果型在 output.status===1 时整卡标红。
    if (msg.event_type === 'tool_call' || msg.event_type === 'tool_result') {
      if (current) {
        current.toolCalls.push(msg.content);
      }
      continue;
    }

    if (msg.event_type === 'token') {
      if (!current) {
        current = {
          id: `agent-${msg.id}`,
          agent: msg.agent,
          role: 'assistant',
          content: '',
          toolCalls: [],
        };
      }
      current.content += msg.content;
      continue;
    }

    if (msg.event_type === 'reasoning') {
      if (!current) {
        current = {
          id: `agent-${msg.id}`,
          agent: msg.agent,
          role: 'assistant',
          content: '',
          toolCalls: [],
        };
      }
      current.reasoning = (current.reasoning ?? '') + msg.content;
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

// 块的内容签名：捕获所有可能变化的字段。签名相同时复用既有块对象引用，
// 使 ChatMessage 的 React.memo 在 invalidate/refetch 重拉取后仍命中。
function signatureOf(block: MessageBlock): string {
  return [
    block.role,
    block.agent,
    block.content,
    block.reasoning ?? '',
    block.toolCalls.join('\n'),
    block.isError ? '1' : '0',
  ].join(' ');
}

interface CachedBlock {
  block: MessageBlock;
  signature: string;
}

// 在原始分组基础上，按 (blockId, 内容签名) 复用上一次的块对象引用；
// 内容真正变化或新增时才产生新引用。缓存自动剔除已不存在的块，保持有界。
function groupMessagesWithCache(
  messages: Message[],
  cache: Map<string, CachedBlock>,
): MessageBlock[] {
  const fresh = groupMessages(messages);
  const previous = new Map(cache);
  cache.clear();
  const next: MessageBlock[] = [];
  for (const block of fresh) {
    const signature = signatureOf(block);
    const cached = previous.get(block.id);
    const reused = cached && cached.signature === signature ? cached.block : block;
    next.push(reused);
    cache.set(block.id, { block: reused, signature });
  }
  return next;
}

// 稳定的空数组：会话无流式段时返回同一引用，避免每次渲染产生新数组触发无限重渲染。
const EMPTY_SEGMENTS: StreamingSegment[] = [];

// 是否为「裸 Confucius」助手条目（块或段）。用于收紧相邻裸块上边距（design D4）。
function isBareConfuciusItem(item: ListItem): boolean {
  if (item.kind === 'block') {
    return item.block.role === 'assistant' && item.block.agent === 'Confucius';
  }
  return item.segment.agent === 'Confucius';
}

const SCROLL_THRESHOLD = 80;

export function MessageList() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const { data, isLoading } = useMessages(activeSessionId);
  const streamingSegments = useUIStore((s) =>
    activeSessionId ? s.streamingSegments[activeSessionId] ?? EMPTY_SEGMENTS : EMPTY_SEGMENTS
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const blockCacheRef = useRef<Map<string, CachedBlock>>(new Map());
  const cachedSessionRef = useRef<string | null>(activeSessionId);

  const messages = data?.messages ?? [];
  const blocks = useMemo(() => {
    // 会话切换时清空缓存，避免跨会话复用块对象引用。
    if (cachedSessionRef.current !== activeSessionId) {
      blockCacheRef.current.clear();
      cachedSessionRef.current = activeSessionId;
    }
    return groupMessagesWithCache(messages, blockCacheRef.current);
  }, [messages, activeSessionId]);

  // 流式进行中 = 任一活动段处于 running / tool_call。
  // 本轮已结束段（idle / error）在 reconcile 清空前仍留在尾部，按其折叠/展开形态渲染。
  const isStreaming = streamingSegments.some(
    (seg) => seg.status === 'running' || seg.status === 'tool_call'
  );

  // 虚拟列表条目：已完成消息块 + 尾部按 streamingSegments 映射的 N 个流式 item
  // （每段一个，key 用段 id，保证段追加时不错位/重挂载）。
  const items = useMemo<ListItem[]>(
    () => [
      ...blocks.map((block) => ({ kind: 'block' as const, block })),
      ...streamingSegments.map((segment) => ({ kind: 'streaming' as const, segment })),
    ],
    [blocks, streamingSegments]
  );

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 4,
  });

  const scheduleScrollToBottom = () => {
    if (scrollRafRef.current != null) return; // 已在贴底中，合并重复调度
    // 多帧贴底：虚拟列表的 measureElement 会异步修正动态高度，
    // 仅滚动一次会停在「估算高度」的伪底部，需连续几帧等测量收敛到真实底部。
    let framesLeft = 8;
    const tick = () => {
      const el = scrollRef.current;
      // 仅当用户仍在底部附近时贴底（上滑浏览历史时不打断）。
      if (el && isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      framesLeft -= 1;
      if (framesLeft > 0) {
        scrollRafRef.current = requestAnimationFrame(tick);
      } else {
        scrollRafRef.current = null;
      }
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
  };

  // 卸载时清空块缓存，释放对块对象的引用。
  useEffect(() => {
    return () => {
      blockCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scheduleScrollToBottom();
    }
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
    // 故意不把 streamingSegments 放进依赖：token 高频更新时只在 rAF 里读一次 DOM，
    // 避免每个 token 都触发 effect 和强制同步布局。
    // isStreaming 用于捕获「流式结束」时机：结束时贴底几帧，
    // 随后 onSettled 的 invalidate 重拉取（messages.length 变化）会再次贴底，
    // 让持久化的助手消息加载后滚动到视口。
  }, [messages.length, activeSessionId, isStreaming]);

  // 流式进行中时持续跟随到底：每帧检查是否仍接近底部（用户上滑则停止跟随），
  // 配合虚拟列表的动态高度测量，保证流式尾部始终可见。rAF 天然对齐绘制。
  useEffect(() => {
    if (!isStreaming) return;
    let rafId: number | null = null;
    const tick = () => {
      const el = scrollRef.current;
      if (el && isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [isStreaming]);

  return (
    <ScrollArea ref={scrollRef} onScroll={handleScroll} className="h-full px-4 py-4">
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-16 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          发送第一条消息开始对话
        </div>
      ) : (
        <div
          style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            // 相邻裸 Confucius 块收紧上边距，使其读作一篇连贯文本（design D4）。
            const tightTop =
              virtualRow.index > 0 &&
              isBareConfuciusItem(item) &&
              isBareConfuciusItem(items[virtualRow.index - 1]);
            return (
              <div
                key={item.kind === 'block' ? item.block.id : item.segment.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className={cn(tightTop ? 'pb-2 pt-0' : 'py-2')}>
                  {item.kind === 'block' ? (
                    <ChatMessage block={item.block} />
                  ) : (
                    <AgentMessage
                      agent={item.segment.agent}
                      role="assistant"
                      content={item.segment.content}
                      reasoning={item.segment.reasoning}
                      toolCalls={item.segment.toolCalls}
                      status={item.segment.status}
                      isLive={
                        item.segment.status === 'running' || item.segment.status === 'tool_call'
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
}
