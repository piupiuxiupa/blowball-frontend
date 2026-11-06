import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SessionQueueResponse } from '@/lib/api';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
import { usePendingQueueStore, type QueueConfirmItem } from '@/stores/pending-queue-store';
import { mergeQueueView, shouldKeepConfirm, type PendingQueueItem } from '@/lib/queue-view';

// 会话等待队列读模型（adapt-session-message-queue D3/D4）：
//   查询键 ['session-queue', sessionId]，走 API base（后端 api 分区——与 POST
//   消息 / attach / cancel 的 agent 分区不同，见 api.ts 注释）；路径编码与鉴权由
//   apiGet 统一处理。草稿哨兵不请求（enabled 排除）。
//   有界轮询：本地活跃 run / 等待项存在 / 快照自身非空时 ~1.5s 探测，空闲即停——
//   不持续轮询隐藏会话（hook 只随活动会话挂载）。
//   空队列快照（含后端读取故障降级的空 200）不构成任何终局或撤回证明——它只更新
//   等待展示；队列项消失时仅失效 messages/detail/sessions 缓存，由服务端真值接管
//   （快速完成的 run 由历史重拉补齐，D4）。

const POLL_INTERVAL_MS = 1500;
// 确认项的接管宽限：入队写入对队列读取的可见性有毫秒级竞态，首份快照可能尚未
// 列出刚确认的项——短暂保留等下一轮快照接管，避免等待项闪烁消失。
const CONFIRM_GRACE_MS = 3000;

export function useSessionQueue(sessionId: string | null) {
  const queryClient = useQueryClient();
  const turnRun = useUIStore((s) =>
    sessionId != null ? s.turnRuns[sessionId] ?? null : null
  );
  const confirms = usePendingQueueStore((s) =>
    sessionId != null ? s.confirms[sessionId] ?? EMPTY_CONFIRMS : EMPTY_CONFIRMS
  );

  const query = useQuery({
    queryKey: ['session-queue', sessionId],
    enabled: sessionId != null && sessionId !== DRAFT_SESSION_ID,
    queryFn: () =>
      apiGet<SessionQueueResponse>(
        `/api/v1/sessions/${encodeURIComponent(sessionId as string)}/queue`
      ),
    // 聚焦重取（会话列表/单会话详情同模式）：队列是纯展示读模型，不碰文件内容，
    // 全局关闭 refetchOnWindowFocus 是为保护 Monaco 未保存编辑，与此无涉。
    refetchOnWindowFocus: true,
    // 轮询判据：本地活跃输出（执行阶段）/ 临时确认项 / 快照自身非空（等待阶段，
    // 经函数形式的实时 query.state.data 判定——首份快照发现等待项后自持轮询）。
    // 服务端 generating 但本端无订阅的窗口由详情轮询（useAttachRun）覆盖，attach
    // 后即回到 turnRun 判据。
    refetchInterval: (queueQuery) =>
      turnRun != null ||
      confirms.length > 0 ||
      (queueQuery.state.data as SessionQueueResponse | undefined)?.queue?.length
        ? POLL_INTERVAL_MS
        : false,
  });
  const entries = query.data?.queue ?? EMPTY_ENTRIES;

  // hints（useAttachRun 的详情轮询判据）：快照非空即等待阶段，需继续探测 FIFO
  // 后续 run 的开始（D4——否则 A 结束后 B 开始的窗口无触发源）。
  useEffect(() => {
    if (sessionId == null) return;
    usePendingQueueStore.getState().setHint(sessionId, entries.length > 0);
  }, [sessionId, entries]);

  // 快照接管临时确认项（D3）：在快照中的确认项由服务端条目顶替（merge 层去重）；
  // 不在快照且超宽限的丢弃——可能已被他端撤回或开始执行（执行中项由 merge 层的
  // turnRun 匹配移除；降级空快照造成的误删会在下一轮成功快照恢复展示）。
  useEffect(() => {
    if (sessionId == null || !query.isSuccess) return;
    const ids = new Set(entries.map((entry) => entry.run_id));
    const now = Date.now();
    usePendingQueueStore
      .getState()
      .pruneConfirms(sessionId, (item) => shouldKeepConfirm(item, ids, now, CONFIRM_GRACE_MS));
  }, [sessionId, entries, query.isSuccess]);

  // 队列项消失 ≠ 终局证明（spec）：不清当前流、不宣布执行/撤回成功。仅失效缓存，
  // 让历史/详情/列表按服务端真值刷新——探测前已快速结束的 run 由历史重拉接管
  //（D4）。会话切换时重建基线，不跨会话比较。
  const shrinkRef = useRef<{ sessionId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (sessionId == null || !query.isSuccess) return;
    const ids = new Set(entries.map((entry) => entry.run_id));
    const prev = shrinkRef.current;
    shrinkRef.current = { sessionId, ids };
    if (!prev || prev.sessionId !== sessionId) return;
    const shrunk = [...prev.ids].some((id) => !ids.has(id));
    if (!shrunk) return;
    void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [sessionId, entries, query.isSuccess, queryClient]);

  // 展示合并：服务端 FIFO 序 + run id 去重 + 确认项接管 + 活跃 run 退出等待展示。
  const items = useMemo<PendingQueueItem[]>(
    () => mergeQueueView(entries, confirms, turnRun),
    [entries, confirms, turnRun]
  );

  return { ...query, entries, items };
}

const EMPTY_ENTRIES: NonNullable<SessionQueueResponse['queue']> = [];
const EMPTY_CONFIRMS: QueueConfirmItem[] = [];
