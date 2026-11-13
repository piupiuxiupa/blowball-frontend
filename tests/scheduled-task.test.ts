import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnabledPatch,
  buildResourceBindPatch,
  buildSchedule,
  buildScheduledTaskCreate,
  buildScheduledTaskPatch,
  emptyScheduledTaskDraft,
  hasNextPage,
  isLegacyInteractiveRun,
  isRunActive,
  scheduledTaskToDraft,
  type ScheduledTaskDraft,
} from '@/lib/scheduled-task';
import type { ScheduledTask, ScheduledTaskRun } from '@/lib/api';

const NOW = Date.UTC(2029, 0, 1);

function draft(overrides: Partial<ScheduledTaskDraft> = {}): ScheduledTaskDraft {
  return {
    ...emptyScheduledTaskDraft(),
    name: '日报',
    prompt: '生成日报',
    runAt: '2030-01-02T03:04',
    timezone: 'UTC',
    ...overrides,
  };
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    task_id: 'task-1',
    name: '已消费任务',
    prompt: '原指令',
    schedule: { type: 'at', run_at: '2020-01-01T00:00:00Z', timezone: 'Asia/Shanghai' },
    session: { mode: 'new' },
    enabled: true,
    revision: 1,
    create_time: '2020-01-01T00:00:00Z',
    update_time: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

test('at：未来时间转为 RFC3339，过去时间拒绝', () => {
  assert.deepEqual(buildSchedule(draft(), NOW), {
    type: 'at',
    run_at: new Date('2030-01-02T03:04').toISOString(),
    timezone: 'UTC',
  });
  assert.throws(() => buildSchedule(draft({ runAt: '2028-01-01T00:00' }), NOW), /晚于当前时间/);
  assert.throws(() => buildSchedule(draft({ runAt: '' }), NOW), /选择执行时间/);
});

test('cron：只校验五字段数量，不缩窄合法表达式语法', () => {
  assert.deepEqual(buildSchedule(draft({ scheduleType: 'cron', expression: '  */5  9 * * MON-FRI ' }), NOW), {
    type: 'cron',
    expression: '*/5 9 * * MON-FRI',
    timezone: 'UTC',
  });
  assert.throws(() => buildSchedule(draft({ scheduleType: 'cron', expression: '0 9 * *' }), NOW), /五个字段/);
  assert.throws(() => buildSchedule(draft({ scheduleType: 'cron', expression: '@every 1h' }), NOW), /五个字段/);
});

test('create：显式采用后端缺省会话/启用语义，可选模型字段省略', () => {
  const body = buildScheduledTaskCreate(draft(), NOW);
  assert.deepEqual(body.session, { mode: 'new' });
  assert.equal(body.enabled, true);
  assert.equal('model' in body, false);
  assert.equal('reasoning_effort' in body, false);
});

test('create：existing 策略已退役，草稿残留值也被归一为独立会话', () => {
  const body = buildScheduledTaskCreate(draft({ sessionMode: 'existing', sessionId: 'sess-1' }), NOW);
  assert.deepEqual(body.session, { mode: 'new' });
});

test('PATCH：旧 existing 任务切换到 new 才发送 session 迁移', () => {
  const original = task({ session: { mode: 'existing', session_id: 'sess-1' } });
  const unchanged = buildScheduledTaskPatch(original, scheduledTaskToDraft(original), NOW);
  assert.equal('session' in unchanged, false);
  const migrated = buildScheduledTaskPatch(
    original,
    { ...scheduledTaskToDraft(original), sessionMode: 'new' },
    NOW
  );
  assert.deepEqual(migrated.session, { mode: 'new' });
});

test('资源绑定 patch 携带发布结果与 CAS 的 expected_revision', () => {
  assert.deepEqual(
    buildResourceBindPatch(task({ revision: 7 }), { resource_revision: 3, manifest_hash: 'abc' }),
    { resource_revision: 3, manifest_hash: 'abc', expected_revision: 7 }
  );
});

test('只有 legacy_interactive 执行回落普通会话链路，缺省按任务会话处理', () => {
  const base = {
    occurrence_id: 'o1',
    task_id: 'task-1',
    revision: 1,
    scheduled_for: '2030-01-01T00:00:00Z',
    run_id: 'run-1',
    session_id: 'sess-1',
    session_mode: 'new' as const,
    status: 'succeeded' as const,
    attempt_count: 0,
    create_time: '2030-01-01T00:00:00Z',
    update_time: '2030-01-01T00:00:00Z',
  };
  assert.equal(isLegacyInteractiveRun({ ...base, session_source: 'legacy_interactive' }), true);
  assert.equal(isLegacyInteractiveRun({ ...base, session_source: 'scheduled' }), false);
  assert.equal(isLegacyInteractiveRun(base), false);
});

test('dirty PATCH：已消费 at 只改名称时绝不回传旧 schedule', () => {
  const original = task();
  const changed = { ...scheduledTaskToDraft(original), name: '新名称' };
  assert.deepEqual(buildScheduledTaskPatch(original, changed, NOW), { name: '新名称' });
});

test('dirty PATCH：显式修改未来 run_at 才重新安排单次任务', () => {
  const original = task();
  const changed = { ...scheduledTaskToDraft(original), runAt: '2030-02-03T04:05' };
  assert.deepEqual(buildScheduledTaskPatch(original, changed, NOW).schedule, {
    type: 'at',
    run_at: new Date('2030-02-03T04:05').toISOString(),
    timezone: changed.timezone,
  });
});

test('enabled PATCH 独立且不夹带表单配置', () => {
  assert.deepEqual(buildEnabledPatch(false), { enabled: false });
  assert.deepEqual(buildEnabledPatch(true), { enabled: true });
});

test('PATCH 不猜测契约未提供的恢复默认语义', () => {
  const original = task({ model: 'model-a', reasoning_effort: 'high' });
  assert.throws(
    () => buildScheduledTaskPatch(original, { ...scheduledTaskToDraft(original), model: '' }, NOW),
    /不支持/
  );
  assert.throws(
    () => buildScheduledTaskPatch(original, { ...scheduledTaskToDraft(original), effort: '' }, NOW),
    /不支持/
  );
});

test('非终态只包含 pending/preparing/launching/running', () => {
  const expected: Record<ScheduledTaskRun['status'], boolean> = {
    pending: true,
    preparing: true,
    launching: true,
    running: true,
    succeeded: false,
    error: false,
    skipped: false,
    cancelled: false,
    interrupted: false,
  };
  for (const [status, active] of Object.entries(expected) as [ScheduledTaskRun['status'], boolean][]) {
    assert.equal(isRunActive(status), active);
  }
});

test('无 total 的分页只按当页 limit 判断下一页', () => {
  assert.equal(hasNextPage(20, 20), true);
  assert.equal(hasNextPage(19, 20), false);
  assert.equal(hasNextPage(0, 20), false);
  assert.equal(hasNextPage(0, 0), false);
});
