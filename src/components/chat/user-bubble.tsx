import { memo } from 'react';
import { User } from 'lucide-react';
import { MarkdownRenderer } from './markdown-renderer';

// 用户消息：右侧主色气泡 + 头像。从原 ChatMessage 的 user 分支抽出，
// 供 AgentMessage 派发器按 role 复用（用户消息渲染形态不变）。
export const UserBubble = memo(function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex flex-row-reverse gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_rgba(255,159,10,0.7)]">
        <User className="h-4 w-4" />
      </div>
      <div className="max-w-[80%] space-y-1 rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),0_8px_20px_-8px_rgba(255,159,10,0.65)]">
        <div className="prose prose-sm prose-invert max-w-none">
          <MarkdownRenderer>{content}</MarkdownRenderer>
        </div>
      </div>
    </div>
  );
});
