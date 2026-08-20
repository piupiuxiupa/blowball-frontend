import { useEffect, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { useSendMessage } from '@/hooks/use-send-message';
import { cancelTurn } from '@/hooks/use-turn-lifecycle';
import { useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface MessageInputProps {
  disabled?: boolean;
}

export function MessageInput({ disabled }: MessageInputProps) {
  const [content, setContent] = useState('');
  // 取消中：已请求取消、终局事件未到（取消是异步三态，他副本路径 ≤ 心跳周期）。
  // 期间停止按钮禁用防抖；终局到达后 busy 翻 false 复位。取消端点幂等，即便重复
  // 触发也无副作用，这里是纯 UI 防抖。
  const [stopping, setStopping] = useState(false);
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  // 本会话有活跃 turn（发送流进行中或 attach 中）即视为忙碌——attach 不是
  // mutation、不占 isPending，但运行中会话再发必 409，输入一律禁用。
  const turnActive = useUIStore((s) =>
    s.activeSessionId != null && s.turnRuns[s.activeSessionId] != null,
  );
  const { mutate: sendMessage, isPending } = useSendMessage();

  const busy = isPending || turnActive;

  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  const handleSubmit = () => {
    if (!activeSessionId || !content.trim() || busy) return;
    sendMessage({ sessionId: activeSessionId, content: content.trim() });
    setContent('');
  };

  // 停止 = 显式取消 turn（turn-detach-resume：断开连接不再取消）。取消后本端
  // 继续消费既有流至终局事件，部分输出经 reconcile 落显——这里只发取消请求。
  const handleStop = () => {
    if (!activeSessionId || !busy) return;
    const runId = useUIStore.getState().turnRuns[activeSessionId];
    if (!runId) return;
    setStopping(true);
    void cancelTurn(activeSessionId, runId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? '先选择一个会话' : '输入消息，Shift+Enter 换行'}
        disabled={disabled || busy}
        rows={3}
        className="min-h-[80px] flex-1"
      />
      <Button
        onClick={busy ? handleStop : handleSubmit}
        disabled={disabled || stopping || (!busy && !content.trim())}
        size="icon"
        className="h-9 w-9 shrink-0"
        variant={busy ? 'destructive' : 'default'}
      >
        {busy ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
