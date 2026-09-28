import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMessages } from '@/hooks/use-messages';
import { useUIStore, type StreamingSegment } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  attachTimelineToolResult,
  type MessageTimelineItem,
} from '@/lib/message-timeline';
import { parseAdditionalContext } from '@/lib/additional-context';
import { ChatMessage } from './chat-message';
import { ArtifactChips } from './artifact-chips';
import { parseArtifactInfo, type ArtifactInfo } from '@/lib/artifact';
import { AgentMessage } from './agent-message';
import {
  MessageNavigationRail,
  type UserMessageAnchor,
} from './message-navigation-rail';
import type { Message } from '@/lib/api';

export interface MessageBlock {
  id: string;
  agent: string;
  runId: string;
  agentInstanceId: string;
  role: 'user' | 'assistant';
  /** 会话级 turn 序号（1-based）：每条用户消息开启一个 turn，其后续回复继承该值。 */
  turn: number;
  content: string;
  reasoning?: string;
  timeline: MessageTimelineItem[];
  isError?: boolean;
  msgTime?: string;
  // turn-artifacts：所属 turn 的产物列表（该 turn 所有 assistant 块共享，
  // 供块内链接点击时钉版）；renderChips 仅标在产物渲染宿主块上
  // （该 turn 最后一个 assistant 块；无 assistant 块时退化为该 turn 最后一块）。
  turnArtifacts?: ArtifactInfo[];
  renderChips?: boolean;
}

// 虚拟列表的单个条目：已完成消息块，或流式中的某个 agent 段（尾部按段映射为 N 个 item）。
type ListItem =
  | { kind: 'block'; block: MessageBlock }
  | { kind: 'streaming'; segment: StreamingSegment };

// 行的单次 dispatch 身份（子 agent 的父 tool_call id）；NULL/缺失归一为空串（顶层回合）。
function messageRunId(msg: Message): string {
  return typeof msg.run_id === 'string' ? msg.run_id : '';
}

// 动态子 Agent 的稳定实例身份；NULL/缺失归一为空串（顶层/存量回合）。
function messageInstanceId(msg: Message): string {
  return typeof msg.agent_instance_id === 'string' ? msg.agent_instance_id : '';
}

// 复合线程键：优先 (agent, agent_instance_id)，同一实例连同全部 resume 归并为一
// 条线程；存量行无实例身份时退化到 (agent, run_id)。agent 名不含空格，拼接无歧义。
function blockKey(agent: string, runId: string, agentInstanceId = ''): string {
  // 无实例身份的键保留尾部空格，供“子 Agent 到达时挂起顶层块”的既有判断识别。
  return agentInstanceId ? `${agent} i:${agentInstanceId}` : `${agent} r:${runId} `;
}

export function groupMessages(messages: Message[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let turn = 0;
  // turn → 产物累积（artifact 行在 turn 末才出现，先收集、收尾统一挂载）。
  const turnArtifacts = new Map<number, ArtifactInfo[]>();
  // 打开中的块按 agent + 线程身份索引：交错到达的多个实例同时各挂一块；
  // 动态实例的 agent_end 不关闭线程（后续 resume 继续并入），存量 run 仍按
  // run_id 关闭。块在打开时即占位，展示顺序 = 首次开块顺序。
  const open = new Map<string, MessageBlock>();

  const openBlock = (msg: Message): MessageBlock => {
    // 子 agent 的第一个事件（通常是 agent_start，且刚跟在父 invoke tool_call 后）
    // 到达时，先暂时挂起顶层块。后续顶层 token/tool_result 会惰性开一个新的
    // continuation 块并追加在子 agent 块之后，从而恢复“invoke → 子 agent → result”
    // 的全局顺序，而不是把子 agent 整体挤到父 agent 完整消息之后。
    if (messageRunId(msg) !== '') {
      for (const key of open.keys()) {
        if (key.endsWith(' ')) open.delete(key);
      }
    }
    const block: MessageBlock = {
      id: `agent-${msg.id}`,
      agent: msg.agent,
      runId: messageRunId(msg),
      agentInstanceId: messageInstanceId(msg),
      role: 'assistant',
      turn,
      content: '',
      timeline: [],
      msgTime: msg.msg_time,
    };
    // 同一动态实例可能在后续用户回合再次 resume；按线程复用既有块，保证“一个
    // 实例一条线程”的契约，而不是在每个回合都裂成新的气泡。
    const existing = messageInstanceId(msg)
      ? [...blocks]
          .reverse()
          .find((item) => item.agent === msg.agent && item.agentInstanceId === messageInstanceId(msg))
      : undefined;
    if (existing) {
      existing.runId = messageRunId(msg);
      open.set(blockKey(msg.agent, existing.runId, existing.agentInstanceId), existing);
      return existing;
    }
    blocks.push(block);
    open.set(blockKey(msg.agent, messageRunId(msg), messageInstanceId(msg)), block);
    return block;
  };
  const blockFor = (msg: Message): MessageBlock | undefined =>
    open.get(blockKey(msg.agent, messageRunId(msg), messageInstanceId(msg)));

  // 历史分组在本次 useMemo 内新建并填充 block，尚未交给 React state；
  // 这里可以安全地原地合并相邻 token，避免每个 token 都复制 timeline 数组。
  const appendBlockText = (block: MessageBlock, chunk: string) => {
    if (!chunk) return;
    const last = block.timeline[block.timeline.length - 1];
    if (last?.type === 'text') {
      last.content += chunk;
    } else {
      block.timeline.push({ type: 'text', content: chunk });
    }
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      open.clear();
      turn += 1;
      blocks.push({
        id: `user-${msg.id}`,
        agent: 'user',
        runId: '',
        agentInstanceId: '',
        role: 'user',
        turn,
        content: msg.content,
        timeline: [],
        msgTime: msg.msg_time,
      });
      continue;
    }

    // turn-artifacts：产物事件行（turn 末批量、done 前、随事件流持久化）按位置
    // 归属当前 turn；agent 为空，不可开块。按 path 去重（SSE 重放会重复）。
    if (msg.event_type === 'artifact') {
      const info = parseArtifactInfo(msg.content);
      if (info && turn > 0) {
        const list = turnArtifacts.get(turn) ?? [];
        if (!list.some((a) => a.path === info.path)) {
          list.push(info);
          turnArtifacts.set(turn, list);
        }
      }
      continue;
    }

    if (msg.event_type === 'agent_start') {
      // 该 (agent, run_id) 已有开块（如 token 先于 agent_start 惰性建块）则复用。
      // placeholder 模式下子 Agent 行的负载被服务端省略，这个块就是该实例的占位
      // 气泡——正文由浮窗内挂载的 run 懒加载面板补齐（见 SubAgentFloatWindow）。
      if (!blockFor(msg)) openBlock(msg);
      continue;
    }

    if (msg.event_type === 'agent_end') {
      // 只结束存量 run 块；动态实例线程保持打开，后续 resume 并入同块。
      if (!messageInstanceId(msg)) {
        open.delete(blockKey(msg.agent, messageRunId(msg)));
      }
      continue;
    }

    if (msg.event_type === 'agent_error') {
      const current = blockFor(msg);
      if (current) {
        current.isError = true;
        current.content += `\n\n[错误] ${msg.content}`;
        appendBlockText(current, `\n\n[错误] ${msg.content}`);
        // 不关闭块：对齐流式 setSegmentStatus（仅置 error，不结束段）。工具失败时后端
        // 会紧跟一条 tool_result（见 openapi SSEToolResult），若此处关闭块，
        // 该 tool_result 会因无块挂载而丢失，历史里就看不到标红的工具结果气泡。
        // 块由后续 agent_end / agent_start / user 消息正常收尾。
      } else {
        blocks.push({
          id: `error-${msg.id}`,
          agent: msg.agent,
          runId: messageRunId(msg),
          agentInstanceId: messageInstanceId(msg),
          role: 'assistant',
          turn,
          content: `[错误] ${msg.content}`,
          timeline: [{ type: 'text', content: `[错误] ${msg.content}` }],
          isError: true,
          msgTime: msg.msg_time,
        });
      }
      continue;
    }

    // tool_call = 工具调用（{tool_call_id,name,args}）；tool_result = 工具执行结果
    // （{tool_call_id,output:{result,status}}）。调用作为 timeline 节点插到当前位置，
    // 结果按 tool_call_id 合并回对应调用卡；无匹配键时才退化为独立结果卡。
    if (msg.event_type === 'tool_call' || msg.event_type === 'tool_result') {
      let current = blockFor(msg);
      if (!current && msg.event_type === 'tool_result') {
        // 子 agent 可能已把父块暂时挂起；结果仍应回填到同身份最近的父块中。
        current = [...blocks]
          .reverse()
          .find(
            (block) =>
              block.agent === msg.agent &&
              (messageInstanceId(msg)
                ? block.agentInstanceId === messageInstanceId(msg)
                : block.runId === messageRunId(msg))
          );
      }
      if (current) {
        if (msg.event_type === 'tool_call') {
          current.timeline.push({ type: 'tool', content: msg.content });
        } else {
          const attached = attachTimelineToolResult(current.timeline, msg.content);
          if (attached.matched) {
            current.timeline = attached.timeline;
          } else {
            current.timeline.push({ type: 'tool', content: msg.content });
          }
        }
      }
      continue;
    }

    if (msg.event_type === 'plan_updated') {
      const current = blockFor(msg) ?? openBlock(msg);
      current.timeline.push({ type: 'plan', content: msg.content });
      continue;
    }

    if (msg.event_type === 'token') {
      const current = blockFor(msg) ?? openBlock(msg);
      current.content += msg.content;
      appendBlockText(current, msg.content);
      continue;
    }

    if (msg.event_type === 'reasoning') {
      const current = blockFor(msg) ?? openBlock(msg);
      current.reasoning = (current.reasoning ?? '') + msg.content;
    }
  }

  // placeholder 模式收尾：孤立的子 Agent agent_error 块（错误到达时该身份尚无
  // 开块而独立成块）会在 resume 续跑后把整个实例的历史面板再渲染一份。把它
  // 归并进同实例既有线程块，保持面板唯一挂载点。
  const threadByInstance = new Map<string, MessageBlock>();
  for (const block of blocks) {
    if (block.role === 'assistant' && block.agentInstanceId && !block.isError) {
      threadByInstance.set(blockKey(block.agent, block.runId, block.agentInstanceId), block);
    }
  }
  for (const block of blocks) {
    if (block.role !== 'assistant' || !block.isError || !block.agentInstanceId) continue;
    const thread = threadByInstance.get(blockKey(block.agent, block.runId, block.agentInstanceId));
    if (!thread) continue;
    thread.isError = true;
    const suffix = block.content ? `\n\n${block.content}` : '';
    thread.content += suffix;
    if (suffix) {
      const last = thread.timeline[thread.timeline.length - 1];
      if (last?.type === 'text') {
        last.content += suffix;
      } else {
        thread.timeline.push({ type: 'text', content: suffix });
      }
    }
    block.id = thread.id;
  }

  // turn-artifacts 收尾：产物列表挂到该 turn 每个 assistant 块（链接钉版上下文），
  // chips 宿主 = 该 turn 最后一个 assistant 块（无则该 turn 最后一块）。
  for (const [t, artifacts] of turnArtifacts) {
    const inTurn = blocks.filter((b) => b.turn === t);
    if (inTurn.length === 0) continue;
    const host = [...inTurn].reverse().find((b) => b.role === 'assistant') ?? inTurn[inTurn.length - 1];
    for (const b of inTurn) {
      if (b.role === 'assistant') b.turnArtifacts = artifacts;
    }
    host.turnArtifacts = artifacts;
    host.renderChips = true;
  }

  return blocks;
}

// 块的内容签名：捕获所有可能变化的字段。签名相同时复用既有块对象引用，
// 使 ChatMessage 的 React.memo 在 invalidate/refetch 重拉取后仍命中。
function signatureOf(block: MessageBlock): string {
  return [
    block.role,
    block.agent,
    block.turn,
    block.content,
    block.reasoning ?? '',
    block.timeline
      .map((item) => `${item.type}:${item.content}:${item.type === 'tool' ? item.result ?? '' : ''}`)
      .join('\n'),
    block.isError ? '1' : '0',
    block.msgTime ?? '',
    (block.turnArtifacts ?? []).map((a) => `${a.path}:${a.version_id ?? ''}`).join(','),
    block.renderChips ? '1' : '0',
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
const EMPTY_ARTIFACTS: ArtifactInfo[] = [];

// 是否为「裸 Confucius」助手条目（块或段）。用于收紧相邻裸块上边距（design D4）。
function isBareConfuciusItem(item: ListItem): boolean {
  if (item.kind === 'block') {
    return item.block.role === 'assistant' && item.block.agent === 'Confucius';
  }
  return item.segment.agent === 'Confucius';
}

const SCROLL_THRESHOLD = 80;

function userMessagePreview(content: string): string {
  // 附加上下文 XML 对导航没有信息量，预览只展示用户真正输入的正文。
  const parsed = parseAdditionalContext(content);
  const text = (parsed?.rest ?? content).replace(/\s+/g, ' ').trim();
  return text || '（附加上下文消息）';
}

export function MessageList() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const { data, isLoading } = useMessages(activeSessionId);
  const streamingSegments = useUIStore((s) =>
    activeSessionId ? s.streamingSegments[activeSessionId] ?? EMPTY_SEGMENTS : EMPTY_SEGMENTS
  );
  const activeTurnRunId = useUIStore((s) =>
    activeSessionId ? s.turnRuns[activeSessionId] ?? null : null
  );
  // 实时产物条暂存（done.meta.artifacts → reconcile 历史接管后清空）。
  const liveArtifacts = useUIStore((s) =>
    activeSessionId ? s.turnArtifacts[activeSessionId] ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const blockCacheRef = useRef<Map<string, CachedBlock>>(new Map());
  const cachedSessionRef = useRef<string | null>(activeSessionId);
  const navigationHighlightTimerRef = useRef<number | null>(null);
  const [activeUserIndex, setActiveUserIndex] = useState(-1);
  const [highlightedUserBlockId, setHighlightedUserBlockId] = useState<string | null>(null);

  const allMessages = data?.messages ?? [];
  // 写库是流式的：重进/重挂载会话时，React Query 可能拉到当前 turn 已落库的半截
  // assistant 行；同时 attach/SSE 又会重放或继续输出同一 turn。这里按 trace_id 隐藏
  // 活跃 turn 的已持久化行，只保留 streamingSegments 中的一份，终局 reconcile 清空
  // 分段后再由完整历史接管。用户消息不过滤，避免乐观用户消息与真实用户消息互相顶替。
  const messages = useMemo(
    () =>
      activeTurnRunId
        ? allMessages.filter((msg) => msg.role === 'user' || msg.trace_id !== activeTurnRunId)
        : allMessages,
    [allMessages, activeTurnRunId],
  );
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

  // 导航轨道只索引用户回合；itemIndex 保留其在虚拟列表中的真实位置，
  // turnIndex 则是轨道上的均匀刻度序号。
  const userAnchors = useMemo<UserMessageAnchor[]>(() => {
    let turnIndex = 0;
    return blocks.flatMap((block, itemIndex) => {
      if (block.role !== 'user') return [];
      const anchor: UserMessageAnchor = {
        id: block.id,
        itemIndex,
        turnIndex,
        preview: userMessagePreview(block.content),
        msgTime: block.msgTime,
      };
      turnIndex += 1;
      return [anchor];
    });
    // 依赖 blocks 而非 items：流式 token 只更新尾部 segments，不应让用户锚点数组
    // 每 帧 重建，否则当前刻度计算会在每次节流渲染后重复执行。
  }, [blocks]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 4,
  });

  const getNearestUserAnchorIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || userAnchors.length === 0) return -1;

    // Codex 轨道同样以视口 40% 线作为“当前回合”判据：用户通常在顶部保留上文、
    // 底部阅读新回复，40% 比纯顶边更接近实际阅读位置。
    const cursor = el.scrollTop + el.clientHeight * 0.4;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const anchor of userAnchors) {
      const offset = rowVirtualizer.getOffsetForIndex(anchor.itemIndex, 'start')?.[0];
      if (offset == null) continue;
      const distance = Math.abs(offset - cursor);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = anchor.turnIndex;
      }
    }
    return nearest;
  }, [rowVirtualizer, userAnchors]);

  const clearNavigationHighlight = useCallback(() => {
    if (navigationHighlightTimerRef.current != null) {
      window.clearTimeout(navigationHighlightTimerRef.current);
      navigationHighlightTimerRef.current = null;
    }
    setHighlightedUserBlockId(null);
  }, []);

  // 会话切换时导航状态不能跨线程残留；定时器也随之释放。
  useEffect(() => {
    clearNavigationHighlight();
    setActiveUserIndex(-1);
    return () => {
      if (navigationHighlightTimerRef.current != null) {
        window.clearTimeout(navigationHighlightTimerRef.current);
        navigationHighlightTimerRef.current = null;
      }
    };
  }, [activeSessionId, clearNavigationHighlight]);

  useEffect(() => {
    setActiveUserIndex((current) => {
      const next = getNearestUserAnchorIndex();
      return current === next ? current : next;
    });
  }, [getNearestUserAnchorIndex]);

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
    const nextActiveUserIndex = getNearestUserAnchorIndex();
    setActiveUserIndex((current) => (current === nextActiveUserIndex ? current : nextActiveUserIndex));
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

  const handleSelectUserAnchor = (anchor: UserMessageAnchor) => {
    const el = scrollRef.current;
    if (!el) return;

    const virtualRow = rowVirtualizer
      .getVirtualItems()
      .find((row) => row.index === anchor.itemIndex);
    const fullyVisible =
      virtualRow != null &&
      virtualRow.start >= el.scrollTop &&
      virtualRow.end <= el.scrollTop + el.clientHeight;
    if (!fullyVisible) {
      // 手动跳到历史位置视为离开底部，避免流式跟随逻辑把目标行重新拉回尾部。
      isNearBottomRef.current = false;
      rowVirtualizer.scrollToIndex(anchor.itemIndex, {
        align: 'center',
        behavior: 'auto',
      });
    }
    setActiveUserIndex(anchor.turnIndex);

    if (navigationHighlightTimerRef.current != null) {
      window.clearTimeout(navigationHighlightTimerRef.current);
    }
    setHighlightedUserBlockId(anchor.id);
    navigationHighlightTimerRef.current = window.setTimeout(() => {
      navigationHighlightTimerRef.current = null;
      setHighlightedUserBlockId(null);
    }, 1800);
  };

  return (
    <div className="relative h-full">
      <ScrollArea
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn(
          'h-full py-3 pr-4',
          !isLoading && userAnchors.length >= 2 ? 'pl-[46px]' : 'pl-4'
        )}
      >
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
	              const quotedRole =
	                item.kind === 'block' && item.block.role === 'user' ? 'user' : 'agent';
	              return (
	                <div
	                  key={item.kind === 'block' ? item.block.id : item.segment.id}
	                  data-index={virtualRow.index}
	                  data-quoted-context=""
	                  data-quote-turn={
	                    item.kind === 'block'
	                      ? item.block.turn
	                      : (blocks[blocks.length - 1]?.turn ?? 1)
	                  }
	                  data-quote-role={quotedRole}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className={cn(tightTop ? 'pb-1.5 pt-0' : 'py-1.5')}>
                    {item.kind === 'block' ? (
                      <ChatMessage
                        sessionId={activeSessionId}
                        block={item.block}
                        navigationHighlighted={
                          item.block.role === 'user' && item.block.id === highlightedUserBlockId
                        }
                      />
                    ) : (
                      <AgentMessage
                        agent={item.segment.agent}
                        role="assistant"
                        content={item.segment.content}
                        reasoning={item.segment.reasoning}
                        timeline={item.segment.timeline}
	                        agentInstanceId={item.segment.agentInstanceId || undefined}
	                        segmentId={item.segment.id}
	                        runId={item.segment.runId || undefined}
	                        sessionId={activeSessionId}
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
        {liveArtifacts.length > 0 && (
          <div className="pb-2">
            <ArtifactChips artifacts={liveArtifacts} />
          </div>
        )}
      </ScrollArea>
      <MessageNavigationRail
        key={activeSessionId ?? 'no-session'}
        anchors={userAnchors}
        activeIndex={activeUserIndex}
        highlightedId={highlightedUserBlockId}
        onSelect={handleSelectUserAnchor}
      />
    </div>
  );
}
