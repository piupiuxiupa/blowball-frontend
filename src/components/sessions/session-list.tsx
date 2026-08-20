import { MessageSquare, Plus } from 'lucide-react';
import { useSessions } from '@/hooks/use-sessions';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionItem } from './session-item';

export function SessionList() {
  const { sessions, isLoading, error } = useSessions();
  const { activeSessionId, setActiveSession } = useUIStore();
  const isDrafting = activeSessionId === DRAFT_SESSION_ID;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center justify-between border-b border-white/50 bg-white/20 px-3 backdrop-blur-sm">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">会话记录</span>
        {/* 懒创建：点「+」仅本地进入草稿态（零网络请求），首条消息发送时才真实建会话
            （见 message-input 的 create-first 编排）。草稿已在时禁用——草稿单例。 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setActiveSession(DRAFT_SESSION_ID)}
          disabled={isDrafting}
          title="新建会话"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* space-y-1：每个会话项是独立圆角框，给选中态/悬停态之间留出呼吸间距，避免色块紧贴。 */}
        <div className="space-y-1 p-2">
          {/* 草稿合成行：纯前端态，无服务端实体——不渲染重命名/删除等 per-实体操作，
              样式对齐 SessionItem 选中态。切到任何真实会话即静默弃置。 */}
          {isDrafting && (
            <div className="flex items-center gap-2 rounded-xl bg-accent px-2.5 py-2 text-sm text-accent-foreground shadow-[inset_0_0_0_1px_rgba(255,159,10,0.35)]">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="truncate font-medium">新会话</div>
            </div>
          )}

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

          {!isLoading && !isDrafting && sessions.length === 0 && (
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
