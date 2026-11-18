import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetStream, apiPostAgent, ApiRequestError } from '@/lib/api';
import { parseSSEStream, type SSEEvent } from '@/lib/sse';
import type { SessionDetail, SessionListResponse, TurnStatusResponse } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { consumeTurnStream, peekTurnEventId, clearTurnStreamState, reconcileTurnHistory } from '@/lib/turn-stream';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
import { usePendingQueueStore } from '@/stores/pending-queue-store';
import { reconcileContextUsage } from '@/hooks/use-context-usage';

// turn 生命周期的客户端编排（turn-detach-resume + adapt-session-message-queue）：
//   startRunOutput —— 发送路径确认立即执行后，把首帧 + 剩余迭代器交给独立生命周期
//   attachToRun  —— 接入运行中 turn 的事件流（重放 + 追 live），含重连与回落
//   cancelTurn   —— 显式取消（停止按钮 / 会话列表取消入口共用）
//   useAttachRun —— 打开 generating 会话时自动 attach 的 React 入口 + run 发现
// 后端语义：断开连接不取消 turn；取消端点幂等且三态（本进程立即 / 他副本 ≤ 心跳
// 周期 / 死 run 强清 / queued run 直接出队），所有路径都有终局事件——这里只需等流
// 自然关闭。输出消费与组件内 mutation 实例解耦（D2）：长期执行由本模块按 run 持有，
// 终局/回落/迟到的错误回调一律按 (sessionId, runId) 身份条件清理（D5）。

// run 输出订阅注册表：按 (session, run) 持有控制器（预留内部清理/会话删除路径）。
const runControllers = new Map<string, AbortController>();
const runKey = (sessionId: string, runId: string) => `${sessionId}\u0000${runId}`;

// 条件释放登记（D5）：仅当 turnRuns[sessionId] 仍指向本 run（未被新 run 接管）时
// 清除——A 的迟到收尾不能把 B 的登记、停止目标与 attach 防重一并抹掉。
function releaseRun(sessionId: string, runId: string) {
  if (runId && useUIStore.getState().turnRuns[sessionId] === runId) {
    useUIStore.getState().setTurnRun(sessionId, null);
  }
}

// 回落普通历史读取：410（run 保留窗口已过）/ 404（列表项滞后，run 从未存在）/
// 重连耗尽时。按 run owner 清掉它自己的分段/产物/游标（不碰后来接管的其他 run），
// 失效各缓存让观察者重取。
async function fallbackToHistory(sessionId: string, runId: string): Promise<void> {
  useUIStore.getState().clearStreamingSegments(sessionId, runId);
  useUIStore.getState().clearTurnArtifacts(sessionId, runId);
  clearTurnStreamState(sessionId, runId);
  await queryClient.invalidateQueries({ queryKey: ['sessions'] });
  // 详情缓存同步失效（adapt-session-detail）：回落即 run 已不在，滞留的
  // generating=true 会让 useAttachRun 反复发起注定失败的探测。
  await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  await queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
  // session-message-queue：FIFO 已继续前进，等待列表需要重读。
  await queryClient.invalidateQueries({ queryKey: ['session-queue', sessionId] });
}

// 单条 run 的输出生命周期。initial 为发送路径已建立的流（POST 响应 + 已读首帧，
// 200 已到手即服务端已接受）；null 表示用 attach 腿（GET events，重放 + 追 live）。
// 网络异常（非终局断开）以本 run 最后帧 id（Last-Event-ID）退避重连 ≤3 次；
// 410/404 与重试耗尽一律按 run 回落历史。终局正常路径走 reconcile（done 可能早于
// 落库，与发送路径同理）。runId 已知时入口即登记（提交路径的执行真相允许覆盖
// 尚未释放的旧 run 登记——接管即新真相；'' 交给消费循环从 meta 惰性解析）。
async function runOutput(
  sessionId: string,
  runId: string,
  initial: { iterator: AsyncGenerator<SSEEvent, void, unknown>; firstEvent: SSEEvent | null } | null,
  controller: AbortController
): Promise<void> {
  const key = runKey(sessionId, runId);
  runControllers.set(key, controller);
  if (runId) useUIStore.getState().setTurnRun(sessionId, runId);

  // 消费循环内惰性解析出的 run 身份（'' 兜底路径），收尾按解析后的身份条件释放。
  let resolvedRunId = runId;
  const onRunResolved = (id: string) => {
    resolvedRunId = id;
  };

  try {
    let terminal = false;
    try {
      if (initial) {
        await consumeTurnStream(
          sessionId,
          runId,
          initial.iterator,
          initial.firstEvent,
          controller.signal,
          onRunResolved
        );
      } else {
        await consumeEventsLeg();
      }
      // 流自然关闭 = 终局（后端保证；死 run 也有合成 done）。
      terminal = true;
    } catch (err) {
      // 内部清理（预留路径）直接退出，不做回落、不清分段（detach 语义）。
      if (controller.signal.aborted) return;
      // attach 腿不可回放（410 保留窗口过 / 404 列表滞后）：重连无意义，回落历史。
      if (isGoneError(err)) {
        await fallbackToHistory(sessionId, resolvedRunId);
        return;
      }
      // 发送路径已确认接受后的网络异常：按订阅问题处理（D7）——转 attach 语义
      // 有限重连，不重新 POST、不清已接受消息与部分输出。
    }

    for (let attempt = 0; !terminal; attempt++) {
      try {
        await consumeEventsLeg();
        terminal = true;
      } catch (err) {
        if (controller.signal.aborted) return;
        if (isGoneError(err)) {
          await fallbackToHistory(sessionId, resolvedRunId);
          return;
        }
        // 网络异常等：退避重连，耗尽按 run 回落。
        if (attempt >= 2) {
          await fallbackToHistory(sessionId, resolvedRunId);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }

    // 终局收尾：确认落库再按 owner 清流式分段（与 attach 路径共用 reconcile）。
    await reconcileTurnHistory(sessionId, resolvedRunId);
  } finally {
    runControllers.delete(key);
    // 条件释放：新 run 已接管时不删除其登记（场景：A 流关闭后 B 在收尾期间接管）。
    releaseRun(sessionId, resolvedRunId);
    clearTurnStreamState(sessionId, resolvedRunId);
    // context-usage：done 与 usage 落库不原子，按本 run 身份异步做有界核对；
    // 不 await，避免拖住上面的 owner 清理或 FIFO 下一 run 接管。
    void reconcileContextUsage(sessionId, resolvedRunId);
    // turn 终局后让列表徽标（generating）尽快消失，不等下一次聚焦重取；单会话详情
    // 缓存同因（adapt-session-detail）。等待队列同刷（FIFO 已前进，D4 即时刷新）。
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['session-queue', sessionId] });
  }

  async function consumeEventsLeg() {
    // attach 腿：GET /turns/:rid/events（重放 + 追 live，帧格式与 POST 流一致）；
    // Last-Event-ID 按本 run 的游标续传——不携带其他 run 的游标（D5）。
    const response = await apiGetStream(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(resolvedRunId)}/events`,
      { lastEventId: peekTurnEventId(sessionId, resolvedRunId), signal: controller.signal }
    );
    await consumeTurnStream(
      sessionId,
      resolvedRunId,
      parseSSEStream(response),
      null,
      controller.signal,
      onRunResolved
    );
  }
}

function isGoneError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.code === 'HTTP_410' || err.code === 'HTTP_404' || err.code === 'NOT_FOUND')
  );
}

// 发送路径入口（use-send-message）：确认立即执行后移交流。登记在首个 await 前完成，
// mutation 随即 resolve——提交确认与长期执行就此解耦（D2）。
export function startRunOutput(
  sessionId: string,
  runId: string,
  iterator: AsyncGenerator<SSEEvent, void, unknown>,
  firstEvent: SSEEvent | null
): void {
  const controller = new AbortController();
  void runOutput(sessionId, runId, { iterator, firstEvent }, controller).catch(
    (err) => {
      console.error('turn run lifecycle failed', sessionId, runId, err);
    }
  );
}

// 接入运行中 turn：GET /turns/:rid/events 先重放事件日志再追 live，终局事件后端关流。
// 防重：本端已有该会话的活跃订阅（发送流或既有 attach）时不重复建立。
export async function attachToRun(sessionId: string, runId: string): Promise<void> {
  const ui = useUIStore.getState();
  if (ui.turnRuns[sessionId]) return;
  const controller = new AbortController();
  await runOutput(sessionId, runId, null, controller);
}

// 可观察结果的取消（adapt-session-message-queue D6）：撤回等待项必须区分
// cancelled / queued·running·cancelling（与 pump 竞争）/ 已终局状态。
export function cancelTurnStatus(sessionId: string, runId: string): Promise<TurnStatusResponse> {
  return apiPostAgent<TurnStatusResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(runId)}/cancel`
  );
}

// 显式取消运行中 turn（幂等，fire-and-forget）：本端继续消费既有流至终局事件，
// 部分输出经 reconcile 落显——因此这里只发请求，不动任何本地流状态。
// 失败提示用户；取消「他副本 run」时后端经 Redis 标志生效，延迟 ≤ 心跳周期。
export async function cancelTurn(sessionId: string, runId: string): Promise<void> {
  try {
    await cancelTurnStatus(sessionId, runId);
  } catch (err) {
    alert(`取消会话生成失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// 打开（切换到）一个 generating 会话时自动 attach。run id 发现为双通道
// （adapt-session-detail，缓存先行、详情裁决）：
//   快路径——切换瞬间列表缓存已带 generating+run_id 即先行接入，不等详情往返
//   （缓存过时致 run 已终局时由 attach 的 410/404 回落兜底）；
//   详情通道——活动会话的单会话详情查询（GET /sessions/:id）修正缓存漏报
//   （SPA 内部切换不触发列表重取，缓存可能过期未反映他处开始生成），并使聚焦
//   重取能发现「查看中会话在他处开始生成」（此前只能靠发送撞 409 兜底）。
// 详情已加载时以其结果为权威（idle 压制缓存的过时 generating）。
// run_id 仅 generating 为 true 时由后端携带；turnRuns 占位防重复订阅。
// adapt-session-message-queue（D4/3.3）：候选重评估不只靠切换/聚焦——turnRun 释放
//（旧 run 收尾）与详情轮询刷新都会重跑本 effect，FIFO 后续 run 得以自动衔接；
// 详情/队列在等待或执行阶段按 ~1.5s 有界轮询，空闲即停。
export function useAttachRun() {
  const queryClient = useQueryClient();
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const turnRun = useUIStore((s) =>
    s.activeSessionId != null ? s.turnRuns[s.activeSessionId] ?? null : null
  );
  // 等待判据（D4）：队列快照非空（hints，队列 hook 回写）或存在临时确认项。
  const waitingHint = usePendingQueueStore((s) =>
    activeSessionId != null
      ? !!s.hints[activeSessionId] || (s.confirms[activeSessionId]?.length ?? 0) > 0
      : false
  );
  const isRealSession = activeSessionId != null && activeSessionId !== DRAFT_SESSION_ID;

  // 单会话详情新鲜探测：仅活动真实会话启用（草稿哨兵不发请求，spec）。走 API
  // base——CRUD 端点，非流式、不落 agent 分区；聚焦重取的豁免理由同 ['sessions']：
  // 不碰文件内容（全局关闭是为保护 Monaco 未保存编辑）。
  // 轮询条件自读缓存（getQueryData 非响应式，但 detail 订阅会在数据变化时重渲染，
  // 条件随之重算；generating 一旦为真即自持，直到某次探测返回 false 才停）。
  const cachedDetail = queryClient.getQueryData<SessionDetail>(['session', activeSessionId]);
  const poll = turnRun != null || waitingHint || !!cachedDetail?.generating;
  const detailQuery = useQuery({
    queryKey: ['session', activeSessionId],
    enabled: isRealSession,
    queryFn: () =>
      apiGet<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(activeSessionId as string)}`),
    refetchOnWindowFocus: true,
    refetchInterval: poll ? 1500 : false,
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!isRealSession) return;
    const fromCache = queryClient
      .getQueryData<SessionListResponse>(['sessions'])
      ?.sessions.find((s) => s.session_id === activeSessionId);
    // 详情已加载 → 权威裁决；未加载 → 列表缓存快路径先行。
    let candidate: string | undefined;
    if (detail) {
      candidate = detail.generating ? detail.run_id : undefined;
    } else if (fromCache?.generating) {
      candidate = fromCache.run_id;
    }
    if (!candidate) return;
    if (turnRun === candidate) return;
    // 旧订阅未释放（如 A 收尾中、B 已是服务端活跃 run）：跳过本次；A 释放 turnRun
    // 变化会重跑本 effect 再接入 B——不依赖用户切换会话或重新聚焦（spec 场景）。
    if (turnRun) return;
    void attachToRun(activeSessionId as string, candidate);
  }, [activeSessionId, isRealSession, detail, turnRun, queryClient]);
}
