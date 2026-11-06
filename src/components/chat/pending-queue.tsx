import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, File, Folder, Loader2, Quote, Sparkles, Wrench, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui-store';
import { useSessionQueue } from '@/hooks/use-session-queue';
import { cancelTurnStatus } from '@/hooks/use-turn-lifecycle';
import { usePendingQueueStore } from '@/stores/pending-queue-store';
import { useNoticeStore } from '@/stores/notice-store';
import { parseAdditionalContext, type AttachmentItem, type QuotedReference } from '@/lib/additional-context';
import { MessageImageThumbnails } from '@/components/chat/image-attachment-chips';
import { attachmentLabel, attachmentSublabel } from '@/components/chat/attachment-chips';
import type { PendingQueueItem } from '@/lib/queue-view';
import type { TurnStatusResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// 输入区上方的待发送（等待队列）展示（adapt-session-message-queue D3/5.3）：
// 紧凑可折叠；按服务端 FIFO 序 + run id 去重（见 use-session-queue 的合并层）；
// 展示内容预览（剥离 additional_context 序列化块后的正文）、解析后的上下文
// chips、图片缩略图（会话附件 content 端点）、已知模型与入队时间；逐项「撤回」。
// 等待项不写入消息缓存、不进历史导航锚点（等待用户行直到开始执行才落库）。

// 撤回重试参数（D6）：queued/cancelling/running 是撤回与 pump 的竞争结果——
// 围绕同一 run 身份有限次重试，不误伤其他等待项；耗尽后提示稍后查看。
const WITHDRAW_RETRIES = 3;
const WITHDRAW_RETRY_DELAY_MS = 600;

function formatEnqueued(at: string | number): string {
  const date = typeof at === 'number' ? new Date(at) : new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

function ContextChipIcon({ kind }: { kind: AttachmentItem['kind'] }) {
  const cls = 'h-3 w-3 shrink-0 text-muted-foreground';
  switch (kind) {
    case 'file':
      return <File className={cls} />;
    case 'dir':
      return <Folder className={cls} />;
    case 'skill':
      return <Sparkles className={cls} />;
    case 'mcp':
      return <Wrench className={cls} />;
  }
}

// 只读上下文 chips（与输入区 composer chips 同风格——等待项位于输入区上方的
// 浅色玻璃面，不用用户气泡内的 primary 配色形态）。
function PendingContextChips({
  items,
  references,
}: {
  items: AttachmentItem[];
  references: QuotedReference[];
}) {
  if (items.length === 0 && references.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const sub = attachmentSublabel(item);
        return (
          <span
            key={`${item.kind}:${item.path ?? item.name ?? ''}:${item.server ?? ''}`}
            className="flex max-w-full items-center gap-1 rounded-lg border border-white/60 bg-white/50 px-1.5 py-0.5 text-[11px] text-foreground"
            title={item.kind === 'mcp' ? `${item.name} @ ${item.server}` : (item.path ?? item.name)}
          >
            <ContextChipIcon kind={item.kind} />
            <span className="truncate font-medium">{attachmentLabel(item)}</span>
            {item.kind === 'mcp' && (
              <span className="truncate text-muted-foreground">@{item.server}</span>
            )}
            {item.kind !== 'mcp' && sub && (
              <span className="max-w-[8rem] truncate text-muted-foreground">{sub}</span>
            )}
          </span>
        );
      })}
      {references.map((reference, index) => (
        <span
          key={`${index}:${reference.turn}:${reference.role}:${reference.text}`}
          className="flex max-w-full items-center gap-1 rounded-lg border border-white/60 bg-white/50 px-1.5 py-0.5 text-[11px] text-foreground"
          title={reference.text}
        >
          <Quote className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            #{reference.turn}
          </span>
          <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1 font-mono text-[10px] uppercase">
            {reference.role}
          </span>
          <span className="max-w-[12rem] truncate whitespace-nowrap">{reference.text}</span>
        </span>
      ))}
    </div>
  );
}

function PendingQueueItemRow({
  sessionId,
  item,
  withdrawing,
  onWithdraw,
}: {
  sessionId: string;
  item: PendingQueueItem;
  withdrawing: boolean;
  onWithdraw: (runId: string) => void;
}) {
  const parsed = useMemo(() => parseAdditionalContext(item.content), [item.content]);
  const preview =
    (parsed?.rest ?? item.content).replace(/\s+/g, ' ').trim() || '（附加上下文消息）';
  const enqueued = formatEnqueued(item.enqueuedAt);

  return (
    <div className="border-t border-white/40 px-3 py-2 first:border-t-0">
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 items-center gap-1 pt-0.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {enqueued}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-foreground">
            {preview}
          </p>
          {item.model && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={item.model}>
              {item.model}
            </p>
          )}
          <PendingContextChips items={parsed?.items ?? []} references={parsed?.references ?? []} />
          <div className="mt-1">
            <MessageImageThumbnails sessionId={sessionId} attachments={item.attachments} />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={withdrawing}
          onClick={() => onWithdraw(item.runId)}
          title="撤回该等待消息"
          aria-label={`撤回等待消息 ${preview.slice(0, 30)}`}
        >
          {withdrawing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <X className="h-3 w-3" /> 撤回
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function PendingQueue() {
  const sessionId = useUIStore((s) => s.activeSessionId);
  const { items } = useSessionQueue(sessionId);
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [withdrawingRunIds, setWithdrawingRunIds] = useState<Set<string>>(new Set());

  // 撤回（D6）：观察 cancel 端点返回值——cancelled 才确认成功；queued/cancelling/
  // running 保持处理中并围绕同一 run 身份有限次重试（不误伤其他项）；终局状态按
  // 实际情况收敛；请求失败保留等待项并可重试。撤回后即时刷新队列/详情/列表（D4）。
  const withdraw = async (runId: string) => {
    if (!sessionId || withdrawingRunIds.has(runId)) return;
    const push = useNoticeStore.getState().push;
    setWithdrawingRunIds((prev) => new Set(prev).add(runId));
    try {
      let status: TurnStatusResponse['status'] | undefined;
      for (let attempt = 0; attempt < WITHDRAW_RETRIES; attempt++) {
        try {
          status = (await cancelTurnStatus(sessionId, runId)).status;
        } catch (err) {
          push(`撤回请求失败：${err instanceof Error ? err.message : String(err)}（等待项已保留，可重试）`);
          return;
        }
        if (status === 'cancelled') break;
        if (status === 'queued' || status === 'cancelling' || status === 'running') {
          if (attempt < WITHDRAW_RETRIES - 1) {
            await new Promise((resolve) => setTimeout(resolve, WITHDRAW_RETRY_DELAY_MS));
          }
          continue;
        }
        break;
      }
      if (status === 'cancelled') {
        // 即时移除本地确认项（快照项随失效重取消失）。
        usePendingQueueStore.getState().removeConfirm(sessionId, runId);
      } else if (status === 'done' || status === 'error' || status === 'interrupted') {
        push('该消息已执行完毕，不再是可撤回的等待消息');
      } else {
        push('撤回仍在处理中，稍后将随状态刷新显示结果', 'info');
      }
      void queryClient.invalidateQueries({ queryKey: ['session-queue', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } finally {
      setWithdrawingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  if (sessionId == null || items.length === 0) return null;

  return (
    <div className="mb-2 rounded-xl border border-white/60 bg-white/50 backdrop-blur-md">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="font-medium">待发送 {items.length} 条</span>
        <span className="truncate text-[11px]">
          （运行中的会话按队列依次执行，可逐条撤回）
        </span>
      </button>
      {!collapsed && (
        <div className={cn('pb-1')}>
          {items.map((item) => (
            <PendingQueueItemRow
              key={item.runId}
              sessionId={sessionId}
              item={item}
              withdrawing={withdrawingRunIds.has(item.runId)}
              onWithdraw={withdraw}
            />
          ))}
        </div>
      )}
    </div>
  );
}
