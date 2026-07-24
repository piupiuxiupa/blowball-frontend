import { memo } from 'react';
import { User, Bot, Wrench, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './markdown-renderer';

interface ChatMessageProps {
  block: {
    id: string;
    agent: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    toolCalls: string[];
    isError?: boolean;
  };
}

export const ChatMessage = memo(function ChatMessage({ block }: ChatMessageProps) {
  const isUser = block.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_rgba(255,159,10,0.7)]'
            : 'glass text-foreground'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          'max-w-[80%] space-y-1 rounded-2xl px-3.5 py-2.5 text-sm',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),0_8px_20px_-8px_rgba(255,159,10,0.65)]'
            : block.isError
              ? 'rounded-bl-md border border-destructive/40 bg-destructive/10 text-foreground backdrop-blur-md'
              : 'glass rounded-bl-md text-foreground'
        )}
      >
        {!isUser && (
          <div className="text-xs font-medium text-muted-foreground">{block.agent}</div>
        )}

        {block.reasoning && !isUser && (
          <details className="rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 backdrop-blur-md">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
              <Lightbulb className="h-3 w-3" />
              <span>思考过程</span>
            </summary>
            <div className="prose prose-sm max-w-none pt-1 text-muted-foreground">
              <MarkdownRenderer>{block.reasoning}</MarkdownRenderer>
            </div>
          </details>
        )}

        {block.content && (
          <div className={cn('prose prose-sm max-w-none', isUser && 'prose-invert')}>
            <MarkdownRenderer>{block.content}</MarkdownRenderer>
          </div>
        )}

        {block.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {block.toolCalls.map((tool, idx) => (
              <span
                key={idx}
                className="glass-subtle inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                <Wrench className="h-3 w-3" />
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
