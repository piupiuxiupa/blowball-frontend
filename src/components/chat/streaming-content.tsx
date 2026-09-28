import { memo } from 'react';
import { MarkdownRenderer } from './markdown-renderer';

interface StreamingContentProps {
  text: string;
  // true = 活动段（正在输入）：已完结段落按段增量渲染、尾行纯文本；
  // false = 已完成段/持久化块：整段 Markdown 全量解析。
  isLive: boolean;
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

// 活动段渲染：已完结的段落用 Markdown 渲染（按段增量、稳定 key），
// 正在输入的最后一行用纯文本展示，避免每来一个 token 都重新解析整段内容。
function splitStreamingContent(text: string): { completed: StreamSegmentData[]; pending: string } {
  if (!text) return { completed: [], pending: '' };

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

// 裸 Markdown 正文：BareConfucius（活动段）与子 Agent 浮窗（打开时）共用。
// 已完成段直接整段 Markdown（全量解析、按内容 memo）；活动段走增量渲染。
// 正文不做夹高/折叠——核心内容直接完整显示（chat-visual-hierarchy）。
export const StreamingContent = memo(function StreamingContent({ text, isLive }: StreamingContentProps) {
  if (!text) return null;

  if (!isLive) {
    return (
      <div className="prose prose-sm max-w-none">
        <MarkdownRenderer>{text}</MarkdownRenderer>
      </div>
    );
  }

  const { completed, pending } = splitStreamingContent(text);
  return (
    <div className="prose prose-sm max-w-none">
      {completed.map((segment) => (
        <StreamSegment key={segment.startOffset} text={segment.text} />
      ))}
      {pending && <p className="m-0">{pending}</p>}
    </div>
  );
});
