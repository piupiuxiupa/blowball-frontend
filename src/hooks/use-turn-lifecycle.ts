import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetStream, apiPostAgent, ApiRequestError } from '@/lib/api';
import type { SessionDetail, SessionListResponse, TurnStatusResponse } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { consumeTurnStream, peekTurnEventId, clearTurnStreamState, reconcileTurnHistory } from '@/lib/turn-stream';
import { useUIStore } from '@/stores/ui-store';

// turn 生命周期的客户端编排（turn-detach-resume 适配）：
//   attachToRun —— 接入运行中 turn 的事件流（重放 + 追 live），含重连与回落
//   cancelTurn  —— 显式取消（停止按钮 / 会话列表取消入口共用）
//   useAttachRun —— 打开 generating 会话时自动 attach 的 React 入口
// 后端语义：断开连接不取消 turn；取消端点幂等且三态（本进程立即 / 他副本 ≤ 心跳
// 周期 / 死 run 强清），所有路径都有终局事件——这里只需等流自然关闭。

// attach 订阅的中断信号（当前无主动取消场景，预留会话删除等清理路径）。
const attachControllers = new Map<string, AbortController>();

// 回落普通历史读取：410（run 保留窗口已过）/ 404（列表项滞后，run 从未存在）/
// 重连耗尽时。清掉半截流式分段，失效各缓存让观察者重取。
async function fallbackToHistory(sessionId: string): Promise<void> {
  useUIStore.getState().clearStreamingSegments(sessionId);
  await queryClient.invalidateQueries({ queryKey: ['sessions'] });
  // 详情缓存同步失效（adapt-session-detail）：回落即 run 已不在，滞留的
  // generating=true 会让 useAttachRun 反复发起注定失败的探测。
  await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  await queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
}

// 接入运行中 turn：GET /turns/:rid/events 先重放事件日志再追 live，终局事件后端关流。
// 流异常（非终局断开）以最后帧 id（Last-Event-ID）指数退避重连 ≤3 次；410/404 与重试
// 耗尽一律回落历史。终局正常路径走 reconcile（done 可能早于落库，与发送路径同理）。
export async function attachToRun(sessionId: string, runId: string): Promise<void> {
  const ui = useUIStore.getState();
  // 防重：本端已有该会话的活跃订阅（发送流或既有 attach）时不重复建立。
  if (ui.turnRuns[sessionId]) return;
  ui.setTurnRun(sessionId, runId);

  const controller = new AbortController();
  attachControllers.set(sessionId, controller);

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await apiGetStream(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(runId)}/events`,
          { lastEventId: peekTurnEventId(sessionId), signal: controller.signal },
        );
        await consumeTurnStream(sessionId, response, controller.signal);
        // 流自然关闭 = 终局（后端保证；死 run 也有合成 done）。
        break;
      } catch (err) {
        // 内部清理（预留路径）直接退出，不做回落。
        if (controller.signal.aborted) return;
        // run 不可回放（410 保留窗口过 / 404 列表滞后）：重连无意义，回落历史。
        if (
          err instanceof ApiRequestError &&
          (err.code === 'HTTP_410' || err.code === 'HTTP_404' || err.code === 'NOT_FOUND')
        ) {
          await fallbackToHistory(sessionId);
          return;
        }
        // 网络异常等：退避重连，耗尽回落。
        if (attempt >= 2) {
          await fallbackToHistory(sessionId);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }

    // 终局收尾：确认落库再清流式分段（与发送路径共用 reconcile）。
    await reconcileTurnHistory(sessionId);
  } finally {
    attachControllers.delete(sessionId);
    useUIStore.getState().setTurnRun(sessionId, null);
    clearTurnStreamState(sessionId);
    // turn 终局后让列表徽标（generating）尽快消失，不等下一次聚焦重取；
    // 单会话详情缓存同因（adapt-session-detail）。
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }
}

// 显式取消运行中 turn（幂等，fire-and-forget）：本端继续消费既有流至终局事件，
// 部分输出经 reconcile 落显——因此这里只发请求，不动任何本地流状态。
// 失败提示用户；取消「他副本 run」时后端经 Redis 标志生效，延迟 ≤ 心跳周期。
export async function cancelTurn(sessionId: string, runId: string): Promise<void> {
  try {
    await apiPostAgent<TurnStatusResponse>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(runId)}/cancel`,
    );
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
export function useAttachRun() {
  const queryClient = useQueryClient();
  const activeSessionId = useUIStore((s) => s.activeSessionId);

  // 单会话详情新鲜探测：仅活动会话启用（有界请求量：一次切换/一次聚焦各一个
  // GET）。走 API base——CRUD 端点，非流式、不落 agent 分区；聚焦重取的豁免理由
  // 同 ['sessions']：不碰文件内容（全局关闭是为保护 Monaco 未保存编辑）。
  const detailQuery = useQuery({
    queryKey: ['session', activeSessionId],
    enabled: activeSessionId !== null,
    queryFn: () =>
      apiGet<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(activeSessionId as string)}`),
    refetchOnWindowFocus: true,
  });
  const detail = detailQuery.data;

  useEffect(() => {
    if (!activeSessionId) return;
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
    if (useUIStore.getState().turnRuns[activeSessionId]) return;
    void attachToRun(activeSessionId, candidate);
  }, [activeSessionId, detail, queryClient]);
}
