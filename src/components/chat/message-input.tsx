import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Send, Sparkles, Square, Wrench } from 'lucide-react';
import { useSendMessage } from '@/hooks/use-send-message';
import { useSessions } from '@/hooks/use-sessions';
import { cancelTurn } from '@/hooks/use-turn-lifecycle';
import {
  ACCEPTED_IMAGE_MIMES,
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  MAX_MESSAGE_IMAGES,
  useImageAttachmentUpload,
  type PendingImageAttachment,
} from '@/hooks/use-image-attachment-upload';
import { ModelSelector } from '@/components/chat/model-selector';
import { ContextPicker, type PickerEntry, type PickerTab } from '@/components/chat/context-picker';
import { ComposerAttachmentChips } from '@/components/chat/attachment-chips';
import { ComposerImageChips } from '@/components/chat/image-attachment-chips';
import { serializeAdditionalContext } from '@/lib/additional-context';
import type { AttachmentRef } from '@/lib/api';
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
  // 待发送图片（add-image-attachments，design D7）：本地 File + blob 预览，选题零请求；
  // 上传发生在发送时。切换会话不清空（与上下文附加同语义），卸载时统一 revoke。
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  // 发送前的上传阶段：期间整体 busy，防止上传中重复提交。
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadImages = useImageAttachmentUpload();
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

  const busy = turnActive || sendingHere || creatingDraft || uploading;

  // ---- 图片附件（add-image-attachments）----
  // 当前待发送图片的渲染期快照：校验与副作用（alert / createObjectURL /
  // revokeObjectURL）必须发生在渲染管线之外——StrictMode 会双调 updater，
  // updater 本体只允许纯合并。
  const pendingImagesRef = useRef(pendingImages);
  pendingImagesRef.current = pendingImages;

  // 选题零网络请求（spec）：仅预检数量与单张大小，MIME 真值留给后端魔数嗅探。
  // 去重键与上传缓存一致（name+size+lastModified），同一文件重复附加无感跳过。
  const addImages = (files: FileList | File[]) => {
    // 必须先物化：FileList 是 input 的活视图，下方清空 input.value 会把它同步
    // 清空；而 setPendingImages 的 updater 要到下次渲染才执行——若在其中读取
    // FileList 只会得到空列表，按钮选择被静默丢弃（粘贴路径传入的是普通数组，
    // 不受 input 清空影响——正是「按钮不行、粘贴可以」的根因）。
    const incoming = Array.from(files);
    const current = pendingImagesRef.current;
    const seen = new Set(current.map((image) => image.uid));
    const additions: PendingImageAttachment[] = [];
    for (const file of incoming) {
      const uid = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(uid)) continue;
      if (current.length + additions.length >= MAX_MESSAGE_IMAGES) {
        alert(`每条消息最多 ${MAX_MESSAGE_IMAGES} 张图片`);
        break;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        alert(`图片「${file.name}」超过 8MiB 上限`);
        continue;
      }
      seen.add(uid);
      additions.push({ uid, file, previewUrl: URL.createObjectURL(file) });
    }
    if (additions.length > 0) {
      // 纯合并：仅按 uid 去重拼接，无副作用。
      setPendingImages((prev) => {
        const prevUids = new Set(prev.map((image) => image.uid));
        return [...prev, ...additions.filter((image) => !prevUids.has(image.uid))];
      });
    }
    // 允许再次选择同一文件：change 只在值变化时触发。
    // incoming 已物化，随后的清空不再影响本次选择。
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (uid: string) => {
    const target = pendingImagesRef.current.find((image) => image.uid === uid);
    if (target) URL.revokeObjectURL(target.previewUrl);
    setPendingImages((prev) => prev.filter((image) => image.uid !== uid));
  };

  // 卸载时 revoke 当前预览（提交路径已各自 revoke，不在 state 中）。
  useEffect(
    () => () => {
      pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    },
    []
  );

  // 粘贴图片（design D8）：只拦截剪贴板里的图片文件，交给与选图入口同一
  // addImages 管线（类型/数量/大小/去重）；纯文本等不含图片的粘贴不
  // preventDefault，浏览器默认行为零变化。
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && ACCEPTED_IMAGE_MIMES.has(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    e.preventDefault();
    addImages(files);
  };

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
      // 图片现场恢复（spec「非 vision 模型发送被拒」）：提交时已 revoke 快照的
      // blob URL，这里从 File 重新生成本地预览，上传 id 缓存仍在、可直接重发。
      if (variables.images && variables.images.length > 0) {
        setPendingImages(
          variables.images.map(({ uid, file }) => ({
            uid,
            file,
            previewUrl: URL.createObjectURL(file),
          }))
        );
      }
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
    const images = pendingImages;

    // add-image-attachments（design D1）：上传发生在（可能的）建会话之后、消息请求
    // 之前；任一失败中止且不发出消息请求，文本与全部图片保留——成功项已进缓存，
    // 重试仅重传失败项。上传先于 sendMessage 完成，因此 variables 携带真实
    // attachment_ids/引用，乐观消息与落库行同构。
    const send = async (sessionId: string) => {
      let attachmentIds: string[] | undefined;
      let imageAttachments: AttachmentRef[] | undefined;
      if (images.length > 0) {
        setUploading(true);
        try {
          const uploaded = await uploadImages(
            sessionId,
            images.map((image) => image.file)
          );
          attachmentIds = uploaded.map((item) => item.attachment_id);
          imageAttachments = uploaded.map((item) => ({
            id: item.attachment_id,
            filename: item.filename,
            mime: item.mime,
          }));
        } catch (err) {
          alert(err instanceof Error ? err.message : `图片上传失败：${String(err)}`);
          return;
        } finally {
          setUploading(false);
        }
      }
      sendMessage({
        sessionId,
        content: fullContent,
        text,
        items,
        references,
        model: selectedModel ?? undefined,
        reasoningEffort: selectedEffort ?? undefined,
        ...(attachmentIds && imageAttachments ? { attachmentIds, imageAttachments, images } : {}),
      });
      setContent('');
      useAttachmentStore.getState().clear();
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setPendingImages([]);
    };

    if (activeSessionId === DRAFT_SESSION_ID) {
      setCreatingDraft(true);
      try {
        const { session_id } = await createSessionAsync();
        await send(session_id);
      } catch (err) {
        alert(`创建会话失败：${err instanceof Error ? err.message : String(err)}`);
        // 留在草稿态,输入文本保留,可直接重试。
      } finally {
        setCreatingDraft(false);
      }
      return;
    }

    await send(activeSessionId);
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
        {/* 图片附件（add-image-attachments）：选题零请求，满 4 张禁用（契约硬限制，
            非 vision 预测——模型门控只在发送失败时兜底，design D4）。 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addImages(e.target.files);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={disabled || busy || pendingImages.length >= MAX_MESSAGE_IMAGES}
          title="附加图片（每条消息最多 4 张，单张 ≤8MiB）"
          aria-label="附加图片"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" /> 图片
        </Button>
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
      <ComposerImageChips images={pendingImages} onRemove={removeImage} />
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
