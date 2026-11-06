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
import { ApiRequestError, type AttachmentRef } from '@/lib/api';
import { useNoticeStore } from '@/stores/notice-store';
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

// 发送请求拒绝原因 → 非弹窗提示文案（D7：区分「未发送」与已接受；QUEUE_FULL 不
// 自动 attach、不假定容量；SESSION_BUSY 是队列关闭部署的兼容路径——静默转 attach
// 已在 mutation onError 处理，这里只说明本条未被接受）。
function describeSendError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case 'SESSION_BUSY':
        return '会话正在生成且未开启排队，本条消息未发送（已接入当前生成，内容已保留）';
      case 'QUEUE_FULL':
        return '等待队列已满，本条消息未发送；可稍后重试，或先撤回等待中的消息';
      case 'INVALID_MODEL':
      case 'INVALID_EFFORT':
      case 'MODEL_NOT_VISION':
      case 'CONTENT_TOO_LONG':
      case 'REQUEST_TOO_LARGE':
        return `消息被拒绝：${err.message}`;
      default:
        return `发送失败：${err.message}`;
    }
  }
  return `发送失败：${err instanceof Error ? err.message : String(err)}`;
}

export function MessageInput({ disabled }: MessageInputProps) {
  const [content, setContent] = useState('');
  // 停止中：绑定取消目标 run id（4.2）——目标终局或 active run 变化即复位，
  // 不能等全局 busy 翻 false，否则连续执行会把下一轮停止按钮一直锁住。取消端点
  // 幂等，重复触发无副作用，这里是纯 UI 防抖。
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  // 草稿首条消息的建会话阶段（create-first 编排）：期间发送按钮禁用，
  // 防双击连建两个会话。
  const [creatingDraft, setCreatingDraft] = useState(false);
  // 待发送图片（add-image-attachments，design D7）：本地 File + blob 预览，选题零请求；
  // 上传发生在发送时。切换会话不清空（与上下文附加同语义），卸载时统一 revoke。
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  // 发送前的上传阶段：期间发送按钮禁用，防止上传中重复提交。
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadImages = useImageAttachmentUpload();
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  // 活跃 run（运行/attach 期间）：停止按钮的取消目标。运行本身不再禁用编辑
  //（5.1：运行中允许编辑正文、选模型、附加上下文/图片并继续提交——队列接受等待）。
  const activeRunId = useUIStore((s) =>
    s.activeSessionId != null ? s.turnRuns[s.activeSessionId] ?? null : null,
  );
  const { mutate: sendMessage, isPending, variables, isError, error, isSuccess } = useSendMessage();
  const { createSessionAsync } = useSessions();
  // 下一次发送的模型/思考等级（per-request-model）;null = 不发参数跟随后端缺省。
  const selectedModel = useUIStore((s) => s.selectedModel);
  const selectedEffort = useUIStore((s) => s.selectedEffort);
  // 提交确认等待（5.1 的提交状态，与运行状态分离）：isPending 是 mutation 实例级
  //（全局），用「最近一次发送的 sessionId === 当前会话」归属到会话，跨会话互不
  // 干扰。仅锁定发送动作，不锁定正文/模型/附件。
  const awaitingConfirm = isPending && variables?.sessionId === activeSessionId;
  // 发送动作防重：建会话 / 上传 / 等待本条提交确认（spec：提交中防重复）。
  const sendLocked = creatingDraft || uploading || awaitingConfirm;

  // 停止中状态复位（4.2）：目标 run 终局（登记释放）或被新 run 接管时。
  useEffect(() => {
    if (stoppingRunId != null && activeRunId !== stoppingRunId) {
      setStoppingRunId(null);
    }
  }, [activeRunId, stoppingRunId]);

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

  // 服务端接受后清空匹配的输入快照（5.2 的清空边界：不再无条件乐观清空 + 失败全局
  // 恢复——失败时输入从未清空，无需恢复；成功也只在「同一会话 + 草稿未修订」时清
  // 空，旧请求的迟到结果不覆盖新草稿）。修订判据用引用/值比较：正文等于提交快照、
  // 图片/上下文数组仍是提交时的引用（任何增删都会换引用）。clearedFor 防重入（同
  // 一条提交只清一次，用户回敲出与快照相同的正文不会被再次清空）。
  const clearedForRef = useRef<unknown>(null);
  useEffect(() => {
    if (!isSuccess || !variables) return;
    if (clearedForRef.current === variables) return;
    if (variables.sessionId !== activeSessionId) return;
    if (content !== variables.text) return;
    // 图片修订判定：提交带图片时引用比较（任何增删换引用）；未带图片时输入区
    // 仍为空才算未修订（确认期间新增的图片属于新草稿，不清）。
    const imagesUnchanged =
      variables.images === undefined
        ? pendingImages.length === 0
        : pendingImages === variables.images;
    if (!imagesUnchanged) return;
    const store = useAttachmentStore.getState();
    if (store.items !== variables.items || store.references !== variables.references) return;
    clearedForRef.current = variables;
    setContent('');
    useAttachmentStore.getState().clear();
    variables.images?.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setPendingImages([]);
    // content/pendingImages 的依赖缺省是有意的：清空动作本身只应在接受瞬间执行
    // 一次，后续修订不应重触发（clearedFor 已防重入）。
  }, [isSuccess, variables]);

  // 请求级失败（QUEUE_FULL / SESSION_BUSY / 拒绝 / 网络等）的非弹窗提示（5.4）：
  // 输入与附件现场从未清空、保留可重试；已接受的连接问题走订阅恢复，不重发 POST。
  const notifiedForRef = useRef<unknown>(null);
  useEffect(() => {
    if (!isError || !error || !variables) return;
    if (notifiedForRef.current === variables) return;
    notifiedForRef.current = variables;
    useNoticeStore.getState().push(describeSendError(error));
  }, [isError, error, variables]);

  // create-first 编排（lazy-session-creation）：草稿态的首条消息先真实建会话再发送。
  // 放在 mutate 之外（而非塞进 mutationFn）——乐观消息 onMutate 按 sessionId 键控缓存,
  // 此时以真实 id 调用,乐观消息直接落在正确键下,零缓存迁移;既有发送路径一行不改。
  // createSessionAsync 的 onSuccess 已把活动会话切到新 id（见 use-sessions）。
  // 失败语义:创建失败留草稿、文本保留;清空只在服务端接受且草稿未修订时发生
  //（见上方 isSuccess effect），任何失败路径都无需恢复输入。
  const handleSubmit = async () => {
    if (!activeSessionId || !content.trim() || sendLocked) return;
    const text = content.trim();
    // 序列化（design D3）：块置于 content 最前，与正文空行分隔；全部为空返回 null，
    // content 与现状完全一致。快照随 mutation 带上，供接受后的清空匹配判定（5.2）。
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
      // 不乐观清空：接受后由 isSuccess effect 按匹配修订清空（5.2）；失败时现场保留。
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

  // 停止 = 显式取消当前活跃 run（turn-detach-resume：断开连接不再取消）。取消后本端
  // 继续消费既有流至终局事件，部分输出经 reconcile 落显——这里只发取消请求。
  // 只针对当前 run（4.2）：不清等待队列（后端取消当前 run 保留其他排队项）。
  const handleStop = () => {
    if (!activeSessionId || !activeRunId || stoppingRunId != null) return;
    setStoppingRunId(activeRunId);
    void cancelTurn(activeSessionId, activeRunId);
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
          disabled={disabled || pendingImages.length >= MAX_MESSAGE_IMAGES}
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          rows={3}
          className={dragOver ? 'min-h-[80px] flex-1 ring-2 ring-inset ring-primary/40' : 'min-h-[80px] flex-1'}
        />
        {/* 发送与停止为独立按钮（5.1）：发送按提交状态锁定（上传/建会话/确认等待/
            正文为空），运行状态不影响发送；停止仅在有活跃 run 时出现，取消目标绑定
            该 run（不撤等待队列）。 */}
        <Button
          onClick={handleSubmit}
          disabled={disabled || sendLocked || !content.trim()}
          size="icon"
          className="h-9 w-9 shrink-0"
          title="发送消息（运行中会话将排队等待）"
          aria-label="发送消息"
        >
          <Send className="h-4 w-4" />
        </Button>
        {activeRunId != null && (
          <Button
            onClick={handleStop}
            disabled={disabled || stoppingRunId != null}
            size="icon"
            variant="destructive"
            className="h-9 w-9 shrink-0"
            title="停止当前生成（保留等待中的消息）"
            aria-label="停止当前生成"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        )}
      </div>
    </div>
  );
}
