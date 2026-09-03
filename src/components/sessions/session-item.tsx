import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Trash2, Pencil, Loader2, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeleteSession, useUpdateSession } from '@/hooks/use-sessions';
import { cancelTurn } from '@/hooks/use-turn-lifecycle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SessionItemProps {
  session: {
    session_id: string;
    title: string;
    update_time?: string;
    // turn-detach-resume：运行中标记与 attach/cancel 目标（run_id 仅 generating 时携带）。
    generating?: boolean;
    run_id?: string;
  };
  isActive: boolean;
  onClick: () => void;
}

export function SessionItem({ session, isActive, onClick }: SessionItemProps) {
  const deleteSession = useDeleteSession();
  const updateSession = useUpdateSession();
  const isDeleting = deleteSession.isPending;
  const isUpdating = updateSession.isPending;
  const label = session.title || '未命名会话';

  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 从列表取消未打开会话的运行中 turn：无需 attach，fire-and-forget 取消，
  // 徽标随列表重取（聚焦重取/失效）消失。幂等端点，重复点击无副作用。
  const handleCancelGenerating = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!session.run_id) return;
    void cancelTurn(session.session_id, session.run_id);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    // Stop propagation so the click doesn't also select the session.
    e.stopPropagation();
    if (!window.confirm(`确定删除会话「${label}」吗？此操作不可撤销。`)) return;
    try {
      await deleteSession.mutateAsync(session.session_id);
    } catch (err) {
      alert(`删除会话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const submitTitle = async (newTitle: string) => {
    const trimmed = newTitle.trim();
    if (trimmed && trimmed !== label) {
      try {
        await updateSession.mutateAsync({ sessionId: session.session_id, title: trimmed });
      } catch (err) {
        alert(`重命名会话失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitTitle(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    void submitTitle(e.target.value);
  };

  return (
    <div className="group relative flex items-center">
      <button
        onClick={onClick}
        disabled={isDeleting || isEditing}
        className={cn(
          // min-w-0：flex item 默认 min-width:auto 会被 nowrap 标题的 min-content 撑大，
          // 按钮不收缩→整行溢出被 ScrollArea 硬裁切，标题的 truncate 永远拿不到宽度约束
          // （无省略号）。放开最小宽度后 ellipsis 才真正生效。
          'flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-all',
          // 生成中多一个取消按钮的空间（pr-20），否则悬停按钮会互相叠压。
          session.generating ? 'pr-20' : 'pr-14',
          isActive
            ? 'bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_rgba(255,159,10,0.35)]'
            : 'hover:bg-foreground/[0.05]',
          isDeleting && 'opacity-50'
        )}
      >
        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <Input
              ref={inputRef}
              defaultValue={session.title}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              disabled={isUpdating}
              className="h-6 px-1 py-0 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{label}</span>
                {session.generating && (
                  // 生成中徽标：后端仍有运行中 turn（断开连接不会取消它）。
                  <span
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                    title="正在生成"
                  />
                )}
              </div>
              {session.update_time && (
                <div className="truncate text-xs text-muted-foreground">
                  {new Date(session.update_time).toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>
      </button>

      {!isEditing && (
        <>
          {session.generating && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-16 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              onClick={handleCancelGenerating}
              disabled={isDeleting || !session.run_id}
              title="取消生成"
              aria-label={`取消会话 ${label} 的生成`}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="absolute right-8 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
            onClick={startEditing}
            disabled={isDeleting}
            title="重命名会话"
            aria-label={`重命名会话 ${label}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            onClick={handleDelete}
            disabled={isDeleting}
            title="删除会话"
            aria-label={`删除会话 ${label}`}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </>
      )}
    </div>
  );
}
