import type {
  ReasoningEffort,
  ScheduleRule,
  ScheduledResourcePublishResponse,
  ScheduledSessionPolicy,
  ScheduledTask,
  ScheduledTaskCreate,
  ScheduledTaskPatch,
  ScheduledTaskRun,
} from '@/lib/api';

export const SCHEDULED_TASK_PAGE_SIZE = 20;

export interface ScheduledTaskDraft {
  name: string;
  prompt: string;
  scheduleType: ScheduleRule['type'];
  runAt: string;
  expression: string;
  timezone: string;
  sessionMode: ScheduledSessionPolicy['mode'];
  sessionId: string;
  model: string;
  effort: ReasoningEffort | '';
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function emptyScheduledTaskDraft(): ScheduledTaskDraft {
  return {
    name: '',
    prompt: '',
    scheduleType: 'at',
    runAt: '',
    expression: '',
    timezone: browserTimeZone(),
    sessionMode: 'new',
    sessionId: '',
    model: '',
    effort: '',
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

// datetime-local 没有时区；按浏览器本地字段展示，提交时再由 Date 解析为同一口径。
export function toDateTimeLocal(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduledTaskToDraft(task: ScheduledTask): ScheduledTaskDraft {
  return {
    name: task.name,
    prompt: task.prompt,
    scheduleType: task.schedule.type,
    runAt: task.schedule.type === 'at' ? toDateTimeLocal(task.schedule.run_at) : '',
    expression: task.schedule.expression ?? '',
    // 单次输入固定使用浏览器时区；cron 保留任务自己的 wall-time 时区。
    timezone: task.schedule.type === 'cron' ? task.schedule.timezone : browserTimeZone(),
    sessionMode: task.session.mode,
    sessionId: task.session.session_id ?? '',
    model: task.model ?? '',
    effort: (task.reasoning_effort ?? '') as ReasoningEffort | '',
  };
}

export function buildSchedule(draft: ScheduledTaskDraft, now = Date.now()): ScheduleRule {
  const timezone = draft.timezone.trim();
  if (!timezone) throw new Error('请填写 IANA 时区');

  if (draft.scheduleType === 'at') {
    if (!draft.runAt) throw new Error('请选择执行时间');
    const date = new Date(draft.runAt);
    if (Number.isNaN(date.getTime())) throw new Error('执行时间格式无效');
    if (date.getTime() <= now) throw new Error('执行时间必须晚于当前时间');
    return { type: 'at', run_at: date.toISOString(), timezone };
  }

  const fields = draft.expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) throw new Error('cron 表达式必须恰好包含五个字段');
  return { type: 'cron', expression: fields.join(' '), timezone };
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

export function buildScheduledTaskCreate(
  draft: ScheduledTaskDraft,
  now = Date.now()
): ScheduledTaskCreate {
  return {
    name: requiredText(draft.name, '请填写任务名称'),
    prompt: requiredText(draft.prompt, '请填写执行指令'),
    schedule: buildSchedule(draft, now),
    // 1.3.0 起 existing 策略退役：新建任务固定每次独立会话，不再提供既有会话选择。
    session: { mode: 'new' },
    enabled: true,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.effort ? { reasoning_effort: draft.effort } : {}),
  };
}

function scheduleChanged(original: ScheduledTaskDraft, draft: ScheduledTaskDraft): boolean {
  if (original.scheduleType !== draft.scheduleType) return true;
  if (draft.scheduleType === 'at') return original.runAt !== draft.runAt;
  return original.expression !== draft.expression || original.timezone !== draft.timezone;
}

export function buildScheduledTaskPatch(
  task: ScheduledTask,
  draft: ScheduledTaskDraft,
  now = Date.now()
): ScheduledTaskPatch {
  const original = scheduledTaskToDraft(task);
  const patch: ScheduledTaskPatch = {};

  if (draft.name !== original.name) patch.name = requiredText(draft.name, '请填写任务名称');
  if (draft.prompt !== original.prompt) patch.prompt = requiredText(draft.prompt, '请填写执行指令');
  // 旧 at 可能已经过去：普通编辑不能回传它，否则会被后端当作重新排期拒绝。
  if (scheduleChanged(original, draft)) patch.schedule = buildSchedule(draft, now);
  // existing 已退役：唯一可达的方向是旧任务迁移到 new（SESSION_POLICY_MIGRATION_REQUIRED）。
  if (draft.sessionMode !== original.sessionMode) patch.session = { mode: 'new' };
  if (draft.model !== original.model) {
    if (!draft.model) throw new Error('当前接口不支持将已选模型恢复为默认');
    patch.model = draft.model;
  }
  if (draft.effort !== original.effort) {
    if (!draft.effort) throw new Error('当前接口不支持将已选思考等级恢复为默认');
    patch.reasoning_effort = draft.effort;
  }
  return patch;
}

export function buildEnabledPatch(enabled: boolean): ScheduledTaskPatch {
  return { enabled };
}

// 发布成功后把版本绑定到任务：CAS 用的 expected_revision 必须是发布时刻的任务 revision。
export function buildResourceBindPatch(
  task: ScheduledTask,
  published: Pick<ScheduledResourcePublishResponse, 'resource_revision' | 'manifest_hash'>
): ScheduledTaskPatch {
  return {
    resource_revision: published.resource_revision,
    manifest_hash: published.manifest_hash,
    expected_revision: task.revision,
  };
}

// 1.3.0 起任务执行会话与普通会话存储分离：legacy_interactive 的历史 occurrence
// 内容仍在普通会话接口下，其余一律走 scheduled-sessions 专用端点。
export function isLegacyInteractiveRun(run: ScheduledTaskRun): boolean {
  return run.session_source === 'legacy_interactive';
}

export function hasNextPage(itemCount: number, limit: number): boolean {
  return limit > 0 && itemCount === limit;
}

export function isRunActive(status: ScheduledTaskRun['status']): boolean {
  return status === 'pending' || status === 'preparing' || status === 'launching' || status === 'running';
}

export const PAUSED_REASON_LABELS: Record<NonNullable<ScheduledTask['paused_reason']>, string> = {
  TASK_PAUSED: '已手动暂停',
  USER_UNAVAILABLE: '用户不可用，任务已暂停',
  SESSION_UNAVAILABLE: '目标会话不可用，任务已暂停',
  TASK_DELETED: '任务已删除',
  SESSION_POLICY_MIGRATION_REQUIRED: '旧“既有会话”策略已停用，需在编辑中切换为“每次创建独立会话”后恢复',
};

export const RUN_STATUS_LABELS: Record<ScheduledTaskRun['status'], string> = {
  pending: '等待执行',
  preparing: '准备中',
  launching: '启动中',
  running: '运行中',
  succeeded: '成功',
  error: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
  interrupted: '已中断',
};

export const RUN_REASON_LABELS: Record<NonNullable<ScheduledTaskRun['reason']>, string> = {
  TASK_OVERLAP: '上一次执行尚未结束',
  TASK_EXECUTION_UNCERTAIN: '执行状态无法确认',
  SESSION_BUSY: '目标会话正忙',
  USER_UNAVAILABLE: '用户不可用',
  SESSION_UNAVAILABLE: '目标会话不可用',
  TASK_TIMEOUT: '执行超时',
  TASK_PAUSED: '任务已暂停',
  TASK_DELETED: '任务已删除',
  ADMISSION_UNAVAILABLE: '无法确认执行准入',
  START_REJECTED: '启动被拒绝',
  RESULT_UNKNOWN: '执行结果未知',
  RESULT_PERSIST_FAILED: '执行结果未能持久化',
  SESSION_POLICY_MIGRATION_REQUIRED: '旧“既有会话”策略已停用',
};
