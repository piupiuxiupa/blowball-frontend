import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useUIStore } from '@/stores/ui-store';
import { reconcileTurnHistory } from '@/lib/turn-stream';
import { queryClient } from '@/lib/query-client';
import type { SessionMessagesResponse } from '@/lib/api';

// 回归覆盖（adapt-session-message-queue 6.3/6.4 的纯逻辑部分）：run owner 条件
// 清理——旧 run 的迟到收尾（reconcile/fallback 同走 clearStreamingSegments/
// clearTurnArtifacts）不删除新 run 的登记、分段与产物；乐观用户行不参与落库计数。

// 按 run 造段：子 Agent 路由身份区分线程（同 agent 同身份会复用段），owner 指定归属。
function seedSegments(sessionId: string, runs: string[]) {
  runs.forEach((runId, index) => {
    useUIStore
      .getState()
      .startAgentSegment(sessionId, 'Confucius', { runId: `sub-${index}`, ownerRunId: runId });
  });
}

test('clearStreamingSegments：A 的收尾只清 A 与身份未知段，B 的输出保留', () => {
  const sessionId = 's-owner-clear';
  seedSegments(sessionId, ['rA', 'rB']);
  // 契约兜底路径遗留的 '' owner 段（第三个子路由身份）。
  useUIStore
    .getState()
    .startAgentSegment(sessionId, 'Confucius', { runId: 'sub-unknown', ownerRunId: '' });
  useUIStore.getState().clearStreamingSegments(sessionId, 'rA');
  const segments = useUIStore.getState().streamingSegments[sessionId];
  assert.deepEqual(segments.map((segment) => segment.ownerRunId), ['rB']);
});

test('clearStreamingSegments：无 owner 参数为全局清理（会话删除路径）', () => {
  const sessionId = 's-owner-clear-all';
  seedSegments(sessionId, ['rA', 'rB']);
  useUIStore.getState().clearStreamingSegments(sessionId);
  assert.equal(useUIStore.getState().streamingSegments[sessionId], undefined);
});

test('setTurnRun：新 run 接管覆盖登记；释放以当前值为准（调用方条件判断）', () => {
  const sessionId = 's-turnruns';
  const store = useUIStore.getState();
  store.setTurnRun(sessionId, 'rA');
  assert.equal(useUIStore.getState().turnRuns[sessionId], 'rA');
  store.setTurnRun(sessionId, 'rB');
  assert.equal(useUIStore.getState().turnRuns[sessionId], 'rB');
  // A 的迟到收尾先判断当前值再清（use-turn-lifecycle releaseRun 的规则语义）。
  if (useUIStore.getState().turnRuns[sessionId] === 'rA') store.setTurnRun(sessionId, null);
  assert.equal(useUIStore.getState().turnRuns[sessionId], 'rB');
  store.setTurnRun(sessionId, null);
  assert.equal(useUIStore.getState().turnRuns[sessionId], undefined);
});

test('clearTurnArtifacts：owner 条件清理——新 run 的产物不被旧收尾误删', () => {
  const sessionId = 's-artifacts';
  const store = useUIStore.getState();
  store.setTurnArtifacts(sessionId, 'rA', [{ path: 'a', version_id: 'v1' }] as never);
  store.setTurnArtifacts(sessionId, 'rB', [{ path: 'b', version_id: 'v2' }] as never);
  store.clearTurnArtifacts(sessionId, 'rA');
  assert.deepEqual(useUIStore.getState().turnArtifacts[sessionId]?.runId, 'rB');
  store.clearTurnArtifacts(sessionId);
  assert.equal(useUIStore.getState().turnArtifacts[sessionId], undefined);
});

test('reconcileTurnHistory：A 迟到收尾（B 已接管）不清 B 的段与产物', async () => {
  const sessionId = 's-reconcile-owner';
  seedSegments(sessionId, ['rA', 'rB']);
  useUIStore.getState().setTurnArtifacts(sessionId, 'rA', [] as never);
  useUIStore.getState().setTurnArtifacts(sessionId, 'rB', [{ path: 'b', version_id: 'v2' }] as never);
  // 历史缓存只有已落库行（乐观行 id 为负，不参与落库计数——并发提交不误证）。
  queryClient.setQueryData<SessionMessagesResponse>(['messages', sessionId], {
    messages: [{ id: -1, content: 'optimistic' } as never],
  });
  await reconcileTurnHistory(sessionId, 'rA');
  const segments = useUIStore.getState().streamingSegments[sessionId];
  assert.deepEqual(segments.map((segment) => segment.ownerRunId), ['rB']);
  assert.deepEqual(useUIStore.getState().turnArtifacts[sessionId]?.runId, 'rB');
});
