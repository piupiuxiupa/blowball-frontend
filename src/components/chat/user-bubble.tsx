import { memo, useMemo } from 'react';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './markdown-renderer';
import { MessageAttachmentChips, MessageReferenceChips } from './attachment-chips';
import { parseAdditionalContext } from '@/lib/additional-context';

// 用户消息：右侧主色气泡 + 头像。从原 ChatMessage 的 user 分支抽出，
// 供 AgentMessage 派发器按 role 复用（用户消息渲染形态不变）。
//
// message-context-mentions：content 开头合法的 <additional_context> 块剥离后以
// 只读 chips 呈现，余下正文照常 Markdown（design D10）。解析由 lib 侧保证容错：
// 无块 / 不在开头 / 结构不合法一律返回 null → 原样渲染，正文不丢字。乐观消息与
// 落库历史同为 content 字符串、同走本组件，两阶段呈现天然一致。
export const UserBubble = memo(function UserBubble({
  content,
  isHighlighted,
}: {
  content: string;
  // 导航轨道点击后的短时定位态；ring 是 box-shadow，不改变气泡布局。
  isHighlighted?: boolean;
}) {
  const parsed = useMemo(() => parseAdditionalContext(content), [content]);
  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_rgba(255,159,10,0.7)]">
        <User className="h-4 w-4" />
      </div>
      <div
        className={cn(
          'max-w-[80%] space-y-1 rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground transition-shadow duration-200',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),0_8px_20px_-8px_rgba(255,159,10,0.65)]',
          isHighlighted &&
            'ring-2 ring-white/90 ring-offset-2 ring-offset-background/60'
        )}
      >
        {parsed && <MessageAttachmentChips items={parsed.items} />}
        {parsed && <MessageReferenceChips references={parsed.references} />}
        <div className="prose prose-sm prose-invert max-w-none">
          <MarkdownRenderer>{parsed ? parsed.rest : content}</MarkdownRenderer>
        </div>
      </div>
    </div>
  );
});
