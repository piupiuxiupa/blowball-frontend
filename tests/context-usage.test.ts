import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryClient } from '@/lib/query-client';
import { contextUsageQueryKey } from '@/hooks/use-context-usage';
import type { SessionContextUsageResponse, SessionContextUsageSnapshot } from '@/lib/api';

type ReconcileContextUsage = (sessionId: string, runId: string) => Promise<void>;

async function loadReconcile(): Promise<ReconcileContextUsage> {
  const module = (await import('@/hooks/use-context-usage')) as {
    reconcileContextUsage?: ReconcileContextUsage;
  };
  assert.equal(typeof module.reconcileContextUsage, 'function');
  return module.reconcileContextUsage!;
}

function snapshot(sessionId: string, runId: string): SessionContextUsageSnapshot {
  return {
    available: true,
    session_id: sessionId,
    run_id: runId,
    model: 'test-model',
    context_tokens: 90_000,
    max_context_tokens: 200_000,
    input_budget_tokens: 159_904,
    remaining_tokens: 69_904,
    measurement_basis: 'last_turn_provider_usage',
    measured_at: '2026-11-16T12:00:00.123Z',
  };
}

function jsonResponse(body: SessionContextUsageResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: (call: number) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => handler(++calls);
  return {
    count: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test('context-usage reconcile：旧 run 后读到目标 run 即停止并更新缓存', async () => {
  const reconcile = await loadReconcile();
  const sessionId = 's-context-converges';
  const responses = [snapshot(sessionId, 'run-a'), snapshot(sessionId, 'run-b')];
  const fetchStub = stubFetch((call) => jsonResponse(responses[call - 1] ?? responses[1]));
  try {
    await reconcile(sessionId, 'run-b');
    assert.equal(fetchStub.count(), 2);
    const cached = queryClient.getQueryData<SessionContextUsageResponse>(
      contextUsageQueryKey(sessionId)
    );
    assert.ok(cached && cached.available);
    assert.equal(cached.run_id, 'run-b');
  } finally {
    fetchStub.restore();
    queryClient.removeQueries({ queryKey: contextUsageQueryKey(sessionId) });
  }
});

test('context-usage reconcile：旧 run 与单次失败也只读取四次', async () => {
  const reconcile = await loadReconcile();
  const sessionId = 's-context-bounded';
  const fetchStub = stubFetch((call) => {
    if (call === 2) throw new Error('network unavailable');
    return jsonResponse(snapshot(sessionId, 'run-a'));
  });
  try {
    await reconcile(sessionId, 'run-b');
    assert.equal(fetchStub.count(), 4);
    const cached = queryClient.getQueryData<SessionContextUsageResponse>(
      contextUsageQueryKey(sessionId)
    );
    assert.ok(cached && cached.available);
    assert.equal(cached.run_id, 'run-a');
  } finally {
    fetchStub.restore();
    queryClient.removeQueries({ queryKey: contextUsageQueryKey(sessionId) });
  }
});
