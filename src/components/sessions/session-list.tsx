import { Plus } from 'lucide-react';
import { useSessions } from '@/hooks/use-sessions';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionItem } from './session-item';

export function SessionList() {
  const { sessions, isLoading, error, createSession, isCreating } = useSessions();
  const { activeSessionId, setActiveSession } = useUIStore();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center justify-between border-b border-white/50 bg-white/20 px-3 backdrop-blur-sm">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">会话记录</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => createSession()}
          disabled={isCreating}
          title="新建会话"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* space-y-1：每个会话项是独立圆角框，给选中态/悬停态之间留出呼吸间距，避免色块紧贴。 */}
        <div className="space-y-1 p-2">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {error && (
            <div className="p-2 text-xs text-destructive">加载会话失败</div>
          )}

          {!isLoading && sessions.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground">暂无会话</div>
          )}

          {sessions.map((session) => (
            <SessionItem
              key={session.session_id}
              session={session}
              isActive={session.session_id === activeSessionId}
              onClick={() => setActiveSession(session.session_id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
