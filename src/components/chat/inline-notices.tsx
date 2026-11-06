import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useNoticeStore } from '@/stores/notice-store';
import { cn } from '@/lib/utils';

// 输入区上方的非弹窗提示条（adapt-session-message-queue D7）：发送拒绝原因与
// 撤回结果的统一展示入口。8 秒自动过期，× 可手动关闭；无提示时不占布局。

const NOTICE_TTL_MS = 8000;

export function InlineNotices() {
  const notices = useNoticeStore((s) => s.notices);
  const dismiss = useNoticeStore((s) => s.dismiss);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((notice) =>
      setTimeout(() => dismiss(notice.id), NOTICE_TTL_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;

  return (
    <div className="mb-2 space-y-1">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur-md',
            notice.tone === 'error'
              ? 'border-red-200/60 bg-red-50/70 text-red-700'
              : 'border-white/60 bg-white/50 text-muted-foreground'
          )}
          role="status"
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            className="shrink-0 rounded-sm p-0.5 transition-colors hover:text-destructive"
            aria-label="关闭提示"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
