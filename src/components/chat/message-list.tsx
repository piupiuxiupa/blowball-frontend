import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMessages } from '@/hooks/use-messages';
import { useUIStore } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatMessage } from './chat-message';
import { TokenStream } from './token-stream';
import type { Message } from '@/lib/api';

interface MessageBlock {
  id: string;
  agent: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: string[];
  isStreaming?: boolean;
  isError?: boolean;
}

// 虚拟列表的单个条目：已完成消息块，或流式中的尾部 TokenStream。
type ListItem =
  | { kind: 'block'; block: MessageBlock }
  | { kind: 'streaming' };

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
        blocks.push(current);
        current = null;
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

    if (msg.event_type === 'tool_call') {
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

const SCROLL_THRESHOLD = 80;

export function MessageList() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const { data, isLoading } = useMessages(activeSessionId);
  const streamingText = useUIStore((s) =>
    activeSessionId ? s.streamingTokens[activeSessionId] ?? '' : ''
  );
  const streamingReasoning = useUIStore((s) =>
    activeSessionId ? s.streamingReasoningTokens[activeSessionId] ?? '' : ''
  );
  const agentStatus = useUIStore((s) =>
    activeSessionId ? s.agentStatus[activeSessionId] : null
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

  const isStreaming =
    !!streamingText ||
    !!streamingReasoning ||
    agentStatus?.status === 'running' ||
    agentStatus?.status === 'tool_call';

  // 虚拟列表条目：已完成消息块 + 流式尾部作为最后一个 item，保证滚动到底与渲染一致。
  const items = useMemo<ListItem[]>(
    () => [...blocks.map((block) => ({ kind: 'block' as const, block })), ...(isStreaming ? [{ kind: 'streaming' as const }] : [])],
    [blocks, isStreaming],
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
    // 故意不把 streamingText 放进依赖：token 高频更新时只在 rAF 里读一次 DOM，
    // 避免每个 token 都触发 effect 和强制同步布局。
    // isStreaming 用于捕获「流式结束」时机：结束时贴底几帧，
    // 随后 onSettled 的 invalidate 重拉取（messages.length 变化）会再次贴底，
    // 让持久化的助手消息加载后滚动到视口。
  }, [messages.length, activeSessionId, agentStatus?.status, isStreaming]);

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
            return (
              <div
                key={item.kind === 'block' ? item.block.id : 'streaming'}
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
                <div className="py-2">
                  {item.kind === 'block' ? (
                    <ChatMessage block={item.block} />
                  ) : (
                    <TokenStream
                      agent={agentStatus?.agent || 'Agent'}
                      content={streamingText}
                      reasoning={streamingReasoning}
                      status={agentStatus?.status || 'running'}
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
