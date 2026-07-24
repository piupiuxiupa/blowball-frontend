import { memo } from 'react';
import { Bot, Loader2, Wrench, AlertCircle, Lightbulb } from 'lucide-react';
import { MarkdownRenderer } from './markdown-renderer';

interface TokenStreamProps {
  agent: string;
  content: string;
  reasoning?: string;
  status: 'idle' | 'running' | 'tool_call' | 'error';
}

interface StreamSegmentData {
  text: string;
  // 段落在完整流式文本中的起始字符偏移，单调递增且仅追加，作为稳定的 React key。
  startOffset: number;
}

// 将文本按「空行」切分为段落，返回每段文本及其在原串中的起始字符偏移。
// 空行（仅含空白字符的行）作为段落分隔，不产生段落；其余连续非空行归为同一段落。
function splitParagraphs(text: string): StreamSegmentData[] {
  if (!text) return [];
  const segments: StreamSegmentData[] = [];
  const lines = text.split('\n');

  // 预计算每行在原 text 中的起始偏移（每行后有一个 '\n'）。
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  let paraStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const isBlank = lines[i].trim().length === 0;
    if (isBlank) {
      if (paraStart >= 0) {
        segments.push({
          text: lines.slice(paraStart, i).join('\n'),
          startOffset: lineStarts[paraStart],
        });
        paraStart = -1;
      }
    } else if (paraStart < 0) {
      paraStart = i;
    }
  }
  if (paraStart >= 0) {
    segments.push({
      text: lines.slice(paraStart).join('\n'),
      startOffset: lineStarts[paraStart],
    });
  }
  return segments;
}

// 流式过程中：已完结的段落用 Markdown 渲染（按段增量、稳定 key），
// 正在输入的最后一行用纯文本展示，避免每来一个 token 都重新解析整段内容。
function splitStreamingContent(
  text: string,
  isFinished: boolean,
): { completed: StreamSegmentData[]; pending: string } {
  if (!text) return { completed: [], pending: '' };

  if (isFinished) {
    // 完成态：整段按段落渲染为 Markdown，无 pending 尾行。
    return { completed: splitParagraphs(text), pending: '' };
  }

  // 最后一行（正在输入）作为纯文本尾行；其前的已结算区域按段落切分。
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline === -1) {
    return { completed: [], pending: text };
  }
  const settled = text.slice(0, lastNewline + 1);
  const pending = text.slice(lastNewline + 1);
  return { completed: splitParagraphs(settled), pending };
}

// 单个已完成段落：按内容 memo 化，内容不变时跳过 Markdown 重新解析。
const StreamSegment = memo(function StreamSegment({ text }: { text: string }) {
  return <MarkdownRenderer>{text}</MarkdownRenderer>;
});

export const TokenStream = memo(function TokenStream({ agent, content, reasoning, status }: TokenStreamProps) {
  const isFinished = status === 'idle' || status === 'error';
  const { completed, pending } = splitStreamingContent(content, isFinished);

  return (
    <div className="flex gap-3">
      <div className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground">
        <Bot className="h-4 w-4" />
      </div>

      <div className="glass max-w-[80%] space-y-1 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>{agent}</span>
          {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
          {status === 'tool_call' && <Wrench className="h-3 w-3" />}
          {status === 'error' && <AlertCircle className="h-3 w-3 text-destructive" />}
        </div>

        {reasoning && (
          <details className="rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 backdrop-blur-md" open>
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
              <Lightbulb className="h-3 w-3" />
              <span>思考过程</span>
            </summary>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap pt-1 text-muted-foreground">
              {reasoning}
            </div>
          </details>
        )}

        {(completed.length > 0 || pending) && (
          <div className="prose prose-sm max-w-none">
            {completed.map((segment) => (
              <StreamSegment key={segment.startOffset} text={segment.text} />
            ))}
            {pending && <p className="m-0">{pending}</p>}
          </div>
        )}

        {!content && !reasoning && status === 'running' && (
          <div className="text-xs text-muted-foreground">思考中…</div>
        )}

        {!content && reasoning && status === 'running' && (
          <div className="text-xs text-muted-foreground">思考中…</div>
        )}
      </div>
    </div>
  );
});
