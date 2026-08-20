import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiGetStream, apiPostAgent, ApiRequestError } from '@/lib/api';
import type { SessionListResponse, TurnStatusResponse } from '@/lib/api';
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
// 重连耗尽时。清掉半截流式分段，失效两个缓存让观察者重取。
async function fallbackToHistory(sessionId: string): Promise<void> {
  useUIStore.getState().clearStreamingSegments(sessionId);
  await queryClient.invalidateQueries({ queryKey: ['sessions'] });
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
    // turn 终局后让列表徽标（generating）尽快消失，不等下一次聚焦重取。
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
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

// 打开（切换到）一个 generating 会话时自动 attach。run id 取自会话列表项——
// 这是 reload 后的发现路径（页面已丢失发送时的 X-Run-Id / 事件 meta）。
// 仅在会话切换时判断：正在查看的会话若在他处开始生成，由发送撞 409 的转 attach
// 兜底；列表徽标随聚焦重取更新（见 useSessions 的 refetchOnWindowFocus）。
export function useAttachRun() {
  const queryClient = useQueryClient();
  const activeSessionId = useUIStore((s) => s.activeSessionId);

  useEffect(() => {
    if (!activeSessionId) return;
    const entry = queryClient
      .getQueryData<SessionListResponse>(['sessions'])
      ?.sessions.find((s) => s.session_id === activeSessionId);
    // run_id 仅 generating 为 true 时由后端携带；turnRuns 占位防重复订阅。
    if (!entry?.generating || !entry.run_id) return;
    if (useUIStore.getState().turnRuns[activeSessionId]) return;
    void attachToRun(activeSessionId, entry.run_id);
  }, [activeSessionId, queryClient]);
}
