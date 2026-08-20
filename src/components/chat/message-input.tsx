import { useEffect, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { useSendMessage } from '@/hooks/use-send-message';
import { useSessions } from '@/hooks/use-sessions';
import { cancelTurn } from '@/hooks/use-turn-lifecycle';
import { ModelSelector } from '@/components/chat/model-selector';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
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
  // 草稿首条消息的建会话阶段（create-first 编排）：期间输入与按钮禁用，
  // 防双击连建两个会话。
  const [creatingDraft, setCreatingDraft] = useState(false);
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  // 本会话有活跃 turn（发送流进行中或 attach 中）即视为忙碌——attach 不是
  // mutation、不占 isPending，但运行中会话再发必 409，输入一律禁用。
  const turnActive = useUIStore((s) =>
    s.activeSessionId != null && s.turnRuns[s.activeSessionId] != null,
  );
  const { mutate: sendMessage, isPending, variables, isError } = useSendMessage();
  const { createSessionAsync } = useSessions();
  // 下一次发送的模型/思考等级（per-request-model）;null = 不发参数跟随后端缺省。
  const selectedModel = useUIStore((s) => s.selectedModel);
  const selectedEffort = useUIStore((s) => s.selectedEffort);
  // isPending 是 mutation 实例级的(全局):会话 A 生成中切到会话 B 时它仍为 true,
  // 会把 B 的按钮错显成停止态。用「最近一次发送的 sessionId === 当前会话」把
  // pending 归属到会话,跨会话互不干扰(流式分段本就按会话隔离)。
  const sendingHere = isPending && variables?.sessionId === activeSessionId;

  const busy = turnActive || sendingHere || creatingDraft;

  // 请求级失败（网络/409/400 等，消息未被接受）时恢复输入文本——提交时是乐观清空，
  // 失败后内容不该丢。isError 在下次提交时复位，effect 只在错误出现时触发一次。
  useEffect(() => {
    if (isError && variables?.content) {
      setContent(variables.content);
    }
  }, [isError, variables]);

  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  // create-first 编排（lazy-session-creation）：草稿态的首条消息先真实建会话再发送。
  // 放在 mutate 之外（而非塞进 mutationFn）——乐观消息 onMutate 按 sessionId 键控缓存,
  // 此时以真实 id 调用,乐观消息直接落在正确键下,零缓存迁移;既有发送路径一行不改。
  // createSessionAsync 的 onSuccess 已把活动会话切到新 id（见 use-sessions）。
  // 失败语义:创建失败留草稿、文本保留;清空仅在成功入队后(请求级失败由上方
  // isError effect 恢复文本兜底)。
  const handleSubmit = async () => {
    if (!activeSessionId || !content.trim() || busy) return;
    const text = content.trim();
    const send = (sessionId: string) =>
      sendMessage({
        sessionId,
        content: text,
        model: selectedModel ?? undefined,
        reasoningEffort: selectedEffort ?? undefined,
      });

    if (activeSessionId === DRAFT_SESSION_ID) {
      setCreatingDraft(true);
      try {
        const { session_id } = await createSessionAsync();
        send(session_id);
        setContent('');
      } catch (err) {
        alert(`创建会话失败：${err instanceof Error ? err.message : String(err)}`);
        // 留在草稿态,输入文本保留,可直接重试。
      } finally {
        setCreatingDraft(false);
      }
      return;
    }

    send(activeSessionId);
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
    <div className="flex flex-col gap-2">
      {/* 模型/思考等级选择:影响下一条消息,挂在输入区上方;无可选目录时自行隐藏。 */}
      <ModelSelector />
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
    </div>
  );
}
