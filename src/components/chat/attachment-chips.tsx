import { memo } from 'react';
import { File, Folder, Quote, Sparkles, Wrench, X } from 'lucide-react';
import { selectFile } from '@/hooks/use-file-edit';
import { useAttachmentStore } from '@/stores/attachment-store';
import type {
  AttachmentItem,
  AttachmentKind,
  QuotedReference,
} from '@/lib/additional-context';
import { cn } from '@/lib/utils';

// 附件 chip 的两种形态共用的图标与文案（message-context-mentions）：
//   ComposerAttachmentChips — 输入区 chips 条，可移除（×）；
//   MessageAttachmentChips  — 用户消息气泡内的只读还原形态，文件/目录可点击预览。
// 归一为同一组件文件，保证发送前后 chip 视觉一致（spec「乐观↔落库一致」）。

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

export function attachmentLabel(item: AttachmentItem): string {
  if (item.kind === 'file' || item.kind === 'dir') return basename(item.path ?? '');
  return item.name ?? '';
}

export function attachmentSublabel(item: AttachmentItem): string | undefined {
  if (item.kind === 'file' || item.kind === 'dir') {
    const path = item.path ?? '';
    const parent = path.slice(0, path.lastIndexOf('/'));
    return parent || undefined;
  }
  // mcp chip 的 server 与 tool 同等重要，并入主文案而非子文案（见 ChipIcon 处拼接）。
  return undefined;
}

function ChipIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const cls = cn('h-3 w-3 shrink-0', className);
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

// 序列化时 quote id 是同一 (turn, role) 分组内的 1-based 顺序号；UI 展示同口径。
function quotedGroupId(references: QuotedReference[], index: number): number {
  const current = references[index];
  return references.filter(
    (reference, position) =>
      position <= index && reference.turn === current.turn && reference.role === current.role
  ).length;
}

// 输入区 chips 条：读 attachment store；× 逐项移除（spec「移除 chip」）。
export const ComposerAttachmentChips = memo(function ComposerAttachmentChips() {
  const items = useAttachmentStore((s) => s.items);
  const references = useAttachmentStore((s) => s.references);
  const removeAt = useAttachmentStore((s) => s.removeAt);
  const removeReferenceAt = useAttachmentStore((s) => s.removeReferenceAt);
  if (items.length === 0 && references.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, index) => {
        const sub = attachmentSublabel(item);
        return (
          <span
            key={`${item.kind}:${item.path ?? item.name ?? ''}:${item.server ?? ''}`}
            className="flex max-w-full items-center gap-1 rounded-lg border border-white/60 bg-white/50 px-2 py-1 text-xs text-foreground backdrop-blur-md"
            title={item.kind === 'mcp' ? `${item.name} @ ${item.server}` : (item.path ?? item.name)}
          >
            <ChipIcon kind={item.kind} className="text-muted-foreground" />
            <span className="truncate font-medium">{attachmentLabel(item)}</span>
            {item.kind === 'mcp' && (
              <span className="truncate text-muted-foreground">@{item.server}</span>
            )}
            {item.kind !== 'mcp' && sub && (
              <span className="max-w-[10rem] truncate text-muted-foreground">{sub}</span>
            )}
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="ml-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-destructive"
              title="移除"
              aria-label={`移除附加 ${attachmentLabel(item)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {references.map((reference, index) => (
        <span
          key={`${index}:${reference.turn}:${reference.role}:${reference.text}`}
          className="flex max-w-full items-center gap-1 rounded-lg border border-white/60 bg-white/50 px-2 py-1 text-xs text-foreground backdrop-blur-md"
          title={reference.text}
        >
          <Quote className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            #{reference.turn}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            id:{quotedGroupId(references, index)}
          </span>
          <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1 font-mono text-[10px] uppercase">
            {reference.role}
          </span>
          <span className="max-w-[14rem] truncate whitespace-nowrap">{reference.text}</span>
          <button
            type="button"
            onClick={() => removeReferenceAt(index)}
            className="ml-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-destructive"
            title="移除"
            aria-label={`移除引用 #${reference.turn} ${reference.text}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
});

// 用户消息气泡内的只读划词引用；与附件 chips 一起由 additional_context 解析还原。
export const MessageReferenceChips = memo(function MessageReferenceChips({
  references,
}: {
  references: QuotedReference[];
}) {
  if (references.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
      {references.map((reference, index) => (
        <span
          key={`${index}:${reference.turn}:${reference.role}:${reference.text}`}
          className="flex max-w-full items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-xs text-primary-foreground"
          title={reference.text}
        >
          <Quote className="h-3 w-3 shrink-0 text-primary-foreground/80" />
          <span className="shrink-0 font-mono text-[10px] text-primary-foreground/70">
            #{reference.turn}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-primary-foreground/70">
            id:{quotedGroupId(references, index)}
          </span>
          <span className="shrink-0 rounded-sm bg-white/10 px-1 font-mono text-[10px] uppercase">
            {reference.role}
          </span>
          <span className="max-w-[14rem] truncate whitespace-nowrap">{reference.text}</span>
        </span>
      ))}
    </div>
  );
});

// 用户消息气泡内的只读 chips：由 parseAdditionalContext 的剥离结果渲染；文件/目录
// chip 点击经 selectFile 在中心面板打开（带 dirty 拦截，与侧边栏点击同路径）。
export const MessageAttachmentChips = memo(function MessageAttachmentChips({
  items,
}: {
  items: AttachmentItem[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
      {items.map((item) => {
        const clickable = item.kind === 'file' || item.kind === 'dir';
        const body = (
          <>
            <ChipIcon kind={item.kind} className="text-primary-foreground/80" />
            <span className="truncate font-medium">{attachmentLabel(item)}</span>
            {item.kind === 'mcp' && (
              <span className="truncate text-primary-foreground/70">@{item.server}</span>
            )}
          </>
        );
        const cls = 'flex max-w-full items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-xs text-primary-foreground';
        if (clickable) {
          return (
            <button
              key={`${item.kind}:${item.path}`}
              type="button"
              onClick={() => selectFile(item.path ?? '')}
              className={cn(cls, 'cursor-pointer transition-colors hover:bg-white/25')}
              title={`打开 ${item.path}`}
            >
              {body}
            </button>
          );
        }
        return (
          <span
            key={`${item.kind}:${item.name}:${item.server ?? ''}`}
            className={cls}
            title={item.kind === 'mcp' ? `${item.name} @ ${item.server}` : item.name}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
});
