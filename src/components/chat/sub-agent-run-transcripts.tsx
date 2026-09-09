import { memo, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Loader2, Sparkles } from 'lucide-react';
import { useSubAgentRunDetail, useSubAgentRuns } from '@/hooks/use-subagent-runs';
import type {
  SubAgentRunDetail,
  SubAgentRunSummary,
  SubAgentTranscriptItem,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './markdown-renderer';
import { ToolCallBubble } from './tool-call-bubble';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function statusLabel(status: SubAgentRunSummary['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'capped') return '达到上限';
  return '出错';
}

function StatusIcon({ status }: { status: SubAgentRunSummary['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  }
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  }
  return <Clock3 className="h-3.5 w-3.5 text-amber-600" />;
}

function findResult(
  transcript: SubAgentTranscriptItem[],
  startIndex: number,
  toolCallId: string
): SubAgentTranscriptItem | undefined {
  return transcript.slice(startIndex + 1).find((item) => item.tool_call_id === toolCallId);
}

const TranscriptView = memo(function TranscriptView({ detail }: { detail: SubAgentRunDetail }) {
  return (
    <div className="space-y-2">
      {detail.transcript.map((item, index) => {
        if (item.type === 'task') {
          return (
            <div
              key={`task-${index}`}
              className="rounded-xl border border-white/50 bg-white/45 px-2.5 py-2"
            >
              <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                任务
              </div>
              <div className="prose prose-sm mt-1 max-w-none">
                <MarkdownRenderer>{item.content || '（空任务）'}</MarkdownRenderer>
              </div>
            </div>
          );
        }

        if (item.type === 'assistant') {
          return (
            <div key={`assistant-${index}`} className="space-y-2">
              {item.reasoning_content && (
                <div className="rounded-xl bg-black/[0.035] px-2.5 py-2 text-xs text-muted-foreground">
                  <div className="mb-1 font-medium">思考</div>
                  <div className="whitespace-pre-wrap break-words">{item.reasoning_content}</div>
                </div>
              )}
              {item.content && (
                <div className="prose prose-sm max-w-none">
                  <MarkdownRenderer>{item.content}</MarkdownRenderer>
                </div>
              )}
              {(item.tool_calls ?? []).map((call) => {
                const result = findResult(detail.transcript, index, call.id);
                return (
                  <ToolCallBubble
                    key={call.id}
                    raw={JSON.stringify({ name: call.name, args: call.arguments })}
                    result={
                      result?.content
                        ? JSON.stringify({ output: { result: result.content }, tool_call_id: call.id })
                        : undefined
                    }
                  />
                );
              })}
            </div>
          );
        }

        // 正常 tool_result 已在其 assistant tool_call 卡内合并；这里只兜底渲染
        // 没有可配对调用方的孤儿结果，避免后端补写/legacy 数据被无声丢弃。
        const hasCall = detail.transcript
          .slice(0, index)
          .some((candidate) =>
            (candidate.tool_calls ?? []).some((call) => call.id === item.tool_call_id)
          );
        if (!hasCall) {
          return (
            <ToolCallBubble
              key={`result-${index}`}
              raw={JSON.stringify({ name: item.name ?? '' })}
              result={JSON.stringify({
                output: { result: item.content ?? '' },
                tool_call_id: item.tool_call_id,
              })}
            />
          );
        }

        return null;
      })}
    </div>
  );
});

function RunDetail({
  sessionId,
  agentInstanceId,
  run,
}: {
  sessionId: string;
  agentInstanceId: string;
  run: SubAgentRunSummary;
}) {
  const detail = useSubAgentRunDetail(sessionId, agentInstanceId, run.run_id, true);

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在加载执行详情…
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="px-1 py-2 text-xs text-destructive">
        执行详情加载失败：{detail.error instanceof Error ? detail.error.message : '未知错误'}
      </div>
    );
  }

  if (!detail.data) return null;
  return (
    <div className="px-1 pb-2 pt-1">
      <TranscriptView detail={detail.data} />
    </div>
  );
}

// 单次执行的展开主体：唯一 run 时 initialExpanded 直出明细——placeholder 模式下
// 这个气泡的内容就是它，不让用户多点一次；多 run（resume 续跑）时退为逐条手开。
function RunTranscript({
  sessionId,
  agentInstanceId,
  run,
  initialExpanded,
}: {
  sessionId: string;
  agentInstanceId: string;
  run: SubAgentRunSummary;
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!initialExpanded);

  return (
    <div className="rounded-lg bg-white/35">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
        aria-expanded={expanded}
      >
        <StatusIcon status={run.status} />
        <span className="text-xs font-medium text-foreground">第 {run.run_no} 次执行</span>
        <span className="text-[11px] text-muted-foreground">
          {statusLabel(run.status)} · {run.message_count} 条消息
        </span>
        {run.previous_run_id && (
          <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">续跑</span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {dateTimeFormatter.format(new Date(run.finished_at))}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && <RunDetail sessionId={sessionId} agentInstanceId={agentInstanceId} run={run} />}
    </div>
  );
}

// 子 Agent 实例的内容区（unique-subagent-message-placeholders）：placeholder 模式下
// 气泡内不再有该实例的正文行，这里经 runs 接口取终态执行明细——只有一条 run 时
// 省去头部与点击直接展开 transcript；多条（resume 续跑）按时间倒序列出逐条展开。
// 列表天然不包含当前进行中的 run，实时输出仍由 SSE 段渲染。
export const SubAgentRunTranscripts = memo(function SubAgentRunTranscripts({
  sessionId,
  agentInstanceId,
}: {
  sessionId: string;
  agentInstanceId: string;
}) {
  const runsQuery = useSubAgentRuns(sessionId, agentInstanceId, true);
  const runs = useMemo(() => [...(runsQuery.data?.runs ?? [])].reverse(), [runsQuery.data]);

  if (runsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在加载执行记录…
      </div>
    );
  }

  if (runsQuery.error) {
    return (
      <div className="px-1 py-2 text-xs text-destructive">
        执行记录加载失败：{runsQuery.error instanceof Error ? runsQuery.error.message : '未知错误'}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground">暂无可查看的终态执行</div>
    );
  }

  if (runs.length === 1) {
    return (
      <RunTranscript
        sessionId={sessionId}
        agentInstanceId={agentInstanceId}
        run={runs[0]}
        initialExpanded
      />
    );
  }

  return (
    <section className="rounded-xl border border-white/50 bg-white/25 px-2 py-2">
      <header className="px-1 text-[11px] font-medium text-muted-foreground">
        执行记录（按 run 懒加载）
      </header>
      <div className="mt-1 space-y-1">
        {runs.map((run) => (
          <RunTranscript
            key={run.run_id}
            sessionId={sessionId}
            agentInstanceId={agentInstanceId}
            run={run}
          />
        ))}
      </div>
    </section>
  );
});
