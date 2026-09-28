import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Square, Wrench } from 'lucide-react';
import { useSendMessage } from '@/hooks/use-send-message';
import { useSessions } from '@/hooks/use-sessions';
import { cancelTurn } from '@/hooks/use-turn-lifecycle';
import { ModelSelector } from '@/components/chat/model-selector';
import { ContextPicker, type PickerEntry, type PickerTab } from '@/components/chat/context-picker';
import { ComposerAttachmentChips } from '@/components/chat/attachment-chips';
import { serializeAdditionalContext } from '@/lib/additional-context';
import { PATH_MIME, PATH_TYPE_MIME } from '@/lib/workspace-dnd';
import { useAttachmentStore } from '@/stores/attachment-store';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface MessageInputProps {
  disabled?: boolean;
}

// 触发命中：tab 由触发符决定（@=文件、/=技能工具），start 是触发符在文本中的下标
// （选中后据此摘除触发串与查询）。
interface TriggerMatch {
  tab: PickerTab;
  start: number;
  query: string;
}

// caret 向前扫描触发符（message-context-mentions design D7）：先吃到光标所在的整个
// token（至最近空白/行首），token 首字符决定触发与否——@=文件、/=技能工具。这样
// 「词中 @」（邮箱 a@b）不触发，而 @ 查询里的 `/`（如 @test/aaa.md）也不会被误判
// 成触发符杀掉弹层。查询串内出现空白即自然失效。
function scanTrigger(text: string, caret: number): TriggerMatch | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  const token = text.slice(start, caret);
  if (token.length === 0) return null;
  if (token[0] === '@') return { tab: 'files', start, query: token.slice(1) };
  if (token[0] === '/') return { tab: 'tools', start, query: token.slice(1) };
  return null;
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

  // ---- 附加上下文（message-context-mentions）----
  // 两个弹层来源：trigger = 键入 @ 或 / 触发（携带查询串）；buttonTab = 常驻按钮打开
  //（无查询过滤）。任一非空即视为弹层打开，textarea 键盘语义随之切换。
  const [trigger, setTrigger] = useState<TriggerMatch | null>(null);
  const [buttonTab, setButtonTab] = useState<PickerTab | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [entries, setEntries] = useState<PickerEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const pickerOpen = trigger !== null || buttonTab !== null;
  const pickerTab: PickerTab = trigger?.tab ?? buttonTab ?? 'files';
  const pickerQuery = trigger?.query ?? '';

  // 列表上抛。空数组身份守卫：picker 加载态下 useWorkspace 每次渲染都产出新 []
  //（`data?.files ?? []`），直接 setEntries 会让「渲染→effect→setState→渲染」
  // 空转到数据到达；两侧皆空时保持旧引用让 React 按 Object.is 跳过更新。
  const handleItemsResolved = useCallback((next: PickerEntry[]) => {
    setEntries((prev) => (prev.length === 0 && next.length === 0 ? prev : next));
  }, []);

  // 列表变化时高亮归零并收敛到合法区间（搜索过滤/分组切换会缩短列表）。
  useEffect(() => {
    setActiveIndex((index) => (entries.length === 0 ? 0 : Math.min(index, entries.length - 1)));
  }, [entries]);

  const closePicker = useCallback(() => {
    setTrigger(null);
    setButtonTab(null);
    setEntries([]);
    setActiveIndex(0);
  }, []);

  // IME 组合期间（拼音输入主场景）不扫描触发、不拦截按键（design D7）：
  // 组合文本会反复改写 caret 前内容，扫描结果不稳定。
  const handleCompositionStart = () => {
    composingRef.current = true;
  };
  const handleCompositionEnd = () => {
    composingRef.current = false;
    const el = textareaRef.current;
    if (el) applyTrigger(scanTrigger(el.value, el.selectionStart ?? el.value.length));
  };

  // 内容变化后按 caret 重新扫描触发符：命中即开/更新弹层，失效即关闭。
  // buttonTab 不受扫描影响（按钮打开的弹层不随正文编辑关闭）。
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setContent(next);
    if (composingRef.current) return;
    applyTrigger(scanTrigger(next, e.target.selectionStart ?? next.length));
  };

  const applyTrigger = (match: TriggerMatch | null) => {
    if (!match) {
      setTrigger((prev) => (prev ? null : prev));
      return;
    }
    setTrigger((prev) => {
      if (prev && prev.tab === match.tab && prev.start === match.start && prev.query === match.query) {
        return prev;
      }
      return match;
    });
  };

  // 选中一条目：入 store（内部去重）；触发来源要摘除「触发符 + 查询」串并复位光标，
  // 按钮来源正文不动。摘除后 caret 停在摘除点，继续打字不残留孤立 @。
  const pickEntry = (entry: PickerEntry) => {
    useAttachmentStore.getState().addItem(entry.item);
    if (trigger && textareaRef.current) {
      const el = textareaRef.current;
      const caret = el.selectionStart ?? content.length;
      const start = trigger.start;
      setContent(content.slice(0, start) + content.slice(caret));
      closePicker();
      requestAnimationFrame(() => el.setSelectionRange(start, start));
      return;
    }
    closePicker();
  };

  // 请求级失败（网络/409/400 等，消息未被接受）时恢复输入文本与附件 chips——提交时
  // 是乐观清空，失败后内容不该丢。isError 在下次提交时复位，effect 只在错误出现时
  // 触发一次。恢复用的是提交时快照（variables.text / variables.items），不是全量
  // content（含序列化块，不能回灌 textarea）。
  useEffect(() => {
    if (isError && variables) {
      setContent(variables.text);
      useAttachmentStore.getState().restore(variables.items, variables.references);
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
    // 序列化（design D3）：块置于 content 最前，与正文空行分隔；全部为空返回 null，
    // content 与现状完全一致。快照随 mutation 带上，失败时恢复。
    const items = useAttachmentStore.getState().items;
    const references = useAttachmentStore.getState().references;
    const block = serializeAdditionalContext(items, references);
    const fullContent = block ? `${block}\n\n${text}` : text;
    const send = (sessionId: string) =>
      sendMessage({
        sessionId,
        content: fullContent,
        text,
        items,
        references,
        model: selectedModel ?? undefined,
        reasoningEffort: selectedEffort ?? undefined,
      });

    if (activeSessionId === DRAFT_SESSION_ID) {
      setCreatingDraft(true);
      try {
        const { session_id } = await createSessionAsync();
        send(session_id);
        setContent('');
        useAttachmentStore.getState().clear();
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
    useAttachmentStore.getState().clear();
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
    // IME 组合期内不拦截（否则拼音候选确认的 Enter/方向键被吞）。
    if (e.nativeEvent.isComposing) return;
    // 弹层打开时键盘先归弹层（spec：Enter 选中不发送）；关闭路径按键零改动。
    if (pickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (entries.length > 0) setActiveIndex((i) => (i + 1) % entries.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (entries.length > 0) setActiveIndex((i) => (i - 1 + entries.length) % entries.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = entries[activeIndex];
        if (entry) pickEntry(entry);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ---- 输入区 drop 目标（design D5）----
  // 仅认 PATH_MIME（侧边栏文件树拖拽），不兜底 text/plain——树外任意文本拖入不得
  // 误判为路径。OS 文件拖入不拦截（浏览器默认行为，Non-Goal）。
  // 类型 mime 由文件树拖起时随行写入，缺失时按文件处理（树外旧缓存无该通道的兜底）。
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PATH_MIME)) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // 子元素间移动会触发 dragLeave，仅在真正离开容器时熄灭高亮。
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PATH_MIME)) return;
    e.preventDefault();
    setDragOver(false);
    const path = e.dataTransfer.getData(PATH_MIME);
    if (!path) return;
    const kind = e.dataTransfer.getData(PATH_TYPE_MIME) === 'dir' ? 'dir' : 'file';
    useAttachmentStore.getState().addItem({ kind, path });
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col gap-2"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pickerOpen && (
        <ContextPicker
          tab={pickerTab}
          query={pickerQuery}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onItemsResolved={handleItemsResolved}
          onSelect={pickEntry}
        />
      )}
      {/* 模型/思考等级选择:影响下一条消息,挂在输入区上方;无可选目录时自行隐藏。 */}
      <ModelSelector />
      <div className="flex items-center gap-1">
        {/* 常驻按钮：与 `/` 触发打开同一弹层（不同初始分组），鼠标流入口（spec）。 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={disabled || busy}
          title="附加技能 (Skills)"
          aria-label="附加技能"
          onClick={() => setButtonTab(buttonTab === 'tools' ? null : 'tools')}
        >
          <Sparkles className="h-3.5 w-3.5" /> 技能
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={disabled || busy}
          title="附加工具 (MCP Tools)"
          aria-label="附加工具"
          onClick={() => setButtonTab(buttonTab === 'tools' ? null : 'tools')}
        >
          <Wrench className="h-3.5 w-3.5" /> 工具
        </Button>
        {/* 全局「展开全部/收起全部」：统一控制长正文 ClampedContent 的夹高，
            与 技能/工具 按钮同排、右对齐（输入区上方、状态栏下方）。 */}
      </div>
      {/* chips 条（类邮件附件）：textarea 只承载正文（design D1）。 */}
      <ComposerAttachmentChips />
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onBlur={(e) => {
            // 失焦关闭弹层；弹层行的 onMouseDown 已 preventDefault，点击行不会引发
            // 失焦。焦点移入 composer 容器内（技能/工具按钮）也不关——否则按钮的
            // blur 先收起弹层、click 再当「打开」处理，toggle 永远弹出不回落。
            if (containerRef.current?.contains(e.relatedTarget as Node | null)) return;
            if (pickerOpen) closePicker();
          }}
          placeholder={disabled ? '先选择一个会话' : '输入消息，@ 附加文件，/ 选择技能工具'}
          disabled={disabled || busy}
          rows={3}
          className={dragOver ? 'min-h-[80px] flex-1 ring-2 ring-inset ring-primary/40' : 'min-h-[80px] flex-1'}
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
