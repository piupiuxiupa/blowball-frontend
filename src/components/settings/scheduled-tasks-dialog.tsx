import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ChatMessage } from '@/components/chat/chat-message';
import { groupMessages } from '@/components/chat/message-list';
import { useModels } from '@/hooks/use-models';
import {
  useCancelScheduledRun,
  useCreateScheduledTask,
  useDeleteScheduledTask,
  usePublishScheduledTaskResources,
  useScheduledSessionMessages,
  useScheduledTaskResources,
  useScheduledTaskRuns,
  useScheduledTasks,
  useSetScheduledTaskEnabled,
  useUpdateScheduledTask,
} from '@/hooks/use-scheduled-tasks';
import type {
  ReasoningEffort,
  ScheduledResourceVersion,
  ScheduledTask,
  ScheduledTaskRun,
} from '@/lib/api';
import {
  browserTimeZone,
  buildResourceBindPatch,
  buildScheduledTaskCreate,
  buildScheduledTaskPatch,
  emptyScheduledTaskDraft,
  hasNextPage,
  isLegacyInteractiveRun,
  isRunActive,
  PAUSED_REASON_LABELS,
  RUN_REASON_LABELS,
  RUN_STATUS_LABELS,
  SCHEDULED_TASK_PAGE_SIZE,
  scheduledTaskToDraft,
  type ScheduledTaskDraft,
} from '@/lib/scheduled-task';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';

const DIALOG_TITLE_ID = 'scheduled-tasks-dialog-title';
const EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const SELECT_CLASS =
  'flex h-9 w-full cursor-pointer rounded-2xl border border-white/60 bg-white/55 px-3 text-sm text-foreground backdrop-blur-xl transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; task: ScheduledTask }
  | { kind: 'runs'; task: ScheduledTask }
  // 任务会话（1.3.0 起独立于普通会话列表）：在弹窗内只读渲染历史。
  | { kind: 'session'; task: ScheduledTask; sessionId: string; poll: boolean }
  | { kind: 'resources'; task: ScheduledTask };

interface ScheduledTasksDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ScheduledTasksDialog({ open, onClose }: ScheduledTasksDialogProps) {
  const queryClient = useQueryClient();
  const setActiveSession = useUIStore((state) => state.setActiveSession);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [offset, setOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const tasksQuery = useScheduledTasks(open, offset);
  const historyTaskId = view.kind === 'runs' ? view.task.task_id : '';
  const runsQuery = useScheduledTaskRuns(historyTaskId, open && view.kind === 'runs', runOffset);
  const createMutation = useCreateScheduledTask();
  const updateMutation = useUpdateScheduledTask();
  const enabledMutation = useSetScheduledTaskEnabled();
  const deleteMutation = useDeleteScheduledTask();
  const cancelMutation = useCancelScheduledRun();

  useEffect(() => {
    if (!open) return;
    setView({ kind: 'list' });
    setOffset(0);
    setRunOffset(0);
    createMutation.reset();
    updateMutation.reset();
    enabledMutation.reset();
    deleteMutation.reset();
    cancelMutation.reset();
    // 仅在重新打开时重置；列表轮询绝不能重置正在编辑的草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const tasks = tasksQuery.data?.tasks ?? [];
  const runs = runsQuery.data?.runs ?? [];
  const actionError = enabledMutation.error ?? deleteMutation.error;

  const saveDraft = async (draft: ScheduledTaskDraft) => {
    if (view.kind === 'create') {
      await createMutation.mutateAsync(buildScheduledTaskCreate(draft));
      setOffset(0);
      setView({ kind: 'list' });
      return;
    }
    if (view.kind === 'edit') {
      const patch = buildScheduledTaskPatch(view.task, draft);
      if (Object.keys(patch).length > 0) {
        await updateMutation.mutateAsync({ taskId: view.task.task_id, patch });
      }
      setView({ kind: 'list' });
    }
  };

  const toggleEnabled = async (task: ScheduledTask) => {
    enabledMutation.reset();
    deleteMutation.reset();
    try {
      await enabledMutation.mutateAsync({ taskId: task.task_id, enabled: !task.enabled });
    } catch {
      // mutation.error 在列表内展示，保留当前页供重试。
    }
  };

  const deleteTask = async (task: ScheduledTask) => {
    if (!window.confirm(`确定删除“${task.name}”吗？\n\n未来及未开始的执行会被阻止；已经开始的 Turn 不会自动停止，历史执行事实也会保留。`)) {
      return;
    }
    enabledMutation.reset();
    deleteMutation.reset();
    try {
      await deleteMutation.mutateAsync(task.task_id);
      if (offset > 0 && tasks.length === 1) {
        setOffset(Math.max(0, offset - SCHEDULED_TASK_PAGE_SIZE));
      }
    } catch {
      // mutation.error 在列表内展示。
    }
  };

  const openHistory = (task: ScheduledTask) => {
    setRunOffset(0);
    setView({ kind: 'runs', task });
  };

  // 1.3.0 起任务会话与普通会话分离：legacy_interactive 的历史 occurrence 仍存在
  // 普通会话存储里，沿用旧跳转；其余在弹窗内走 scheduled-sessions 只读视图。
  const openSession = (run: ScheduledTaskRun) => {
    if (view.kind !== 'runs') return;
    if (isLegacyInteractiveRun(run)) {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      setActiveSession(run.session_id);
      return;
    }
    setView({
      kind: 'session',
      task: view.task,
      sessionId: run.session_id,
      poll: isRunActive(run.status),
    });
  };

  const cancelRun = async (run: ScheduledTaskRun) => {
    cancelMutation.reset();
    try {
      await cancelMutation.mutateAsync({
        sessionId: run.session_id,
        runId: run.run_id,
        legacy: isLegacyInteractiveRun(run),
      });
    } catch {
      // mutation.error 在历史视图内展示。
    }
  };

  const subtitle =
    view.kind === 'create'
      ? '创建单次或周期 Agent 任务'
      : view.kind === 'edit'
        ? `编辑 ${view.task.name}`
        : view.kind === 'runs'
          ? `${view.task.name} 的执行事实`
          : view.kind === 'session'
            ? `${view.task.name} 的执行会话`
            : view.kind === 'resources'
              ? `${view.task.name} 的任务资源`
              : '管理计划与查看每次执行结果';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 backdrop-blur-sm sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={DIALOG_TITLE_ID}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-background shadow-xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-white/50 p-4 sm:p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <CalendarClock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={DIALOG_TITLE_ID} className="text-sm font-semibold text-foreground">
              定时任务
            </h2>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </p>
          </div>
          {view.kind === 'list' && (
            <Button size="sm" onClick={() => setView({ kind: 'create' })}>
              <Plus className="h-3.5 w-3.5" /> 新建任务
            </Button>
          )}
          <button
            type="button"
            aria-label="关闭定时任务"
            title="关闭"
            onClick={onClose}
            className="cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {view.kind === 'list' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                暂停或删除只阻止未来及未开始的执行，不会自动停止已经运行的 Turn。
              </p>
              {actionError && (
                <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMessage(actionError)}
                </div>
              )}
              {tasksQuery.isLoading ? (
                <ListSkeleton />
              ) : tasksQuery.error ? (
                <QueryError error={tasksQuery.error} onRetry={() => void tasksQuery.refetch()} />
              ) : tasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-foreground/15 px-4 py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {offset > 0 ? '这一页没有任务' : '还没有定时任务'}
                  </p>
                  {offset === 0 && (
                    <Button className="mt-4" size="sm" onClick={() => setView({ kind: 'create' })}>
                      <Plus className="h-3.5 w-3.5" /> 创建第一个任务
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {tasks.map((task) => {
                    const toggling = enabledMutation.isPending && enabledMutation.variables?.taskId === task.task_id;
                    const deleting = deleteMutation.isPending && deleteMutation.variables === task.task_id;
                    const busy = toggling || deleting;
                    return (
                      <li key={task.task_id} className="rounded-2xl border border-white/60 bg-white/40 p-3.5">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="break-words text-sm font-medium text-foreground">{task.name}</h3>
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[10px]',
                                task.enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-foreground/[0.07] text-muted-foreground'
                              )}>
                                {task.enabled ? '已启用' : '已暂停'}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                              {task.prompt}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="编辑任务" aria-label={`编辑 ${task.name}`} disabled={busy} onClick={() => setView({ kind: 'edit', task })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="删除任务" aria-label={`删除 ${task.name}`} disabled={busy} onClick={() => void deleteTask(task)}>
                              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
                          <div className="break-words">
                            {task.schedule.type === 'at'
                              ? `单次 · ${formatDateTime(task.schedule.run_at)}`
                              : `周期 · ${task.schedule.expression ?? ''}`}
                            <span className="ml-1 font-mono text-[11px]">({task.schedule.timezone})</span>
                          </div>
                          <div className="break-all">
                            {task.session.mode === 'new' ? '每次创建独立会话' : `既有会话 · ${task.session.session_id ?? ''}`}
                          </div>
                          <div className="sm:col-span-2">
                            {task.next_run_at
                              ? `下次执行：${formatDateTime(task.next_run_at)}`
                              : task.schedule.type === 'at'
                                ? '单次排期已消费；仅重新启用不会重跑'
                                : task.enabled
                                  ? '暂无下次执行时间'
                                  : '恢复后由后端计算下次执行时间'}
                          </div>
                          {!task.enabled && task.paused_reason && (
                            <div className="text-amber-700 sm:col-span-2">
                              {PAUSED_REASON_LABELS[task.paused_reason]}
                            </div>
                          )}
                          {task.blocked_reason && (
                            <div className="text-amber-700 sm:col-span-2">
                              执行被服务端挂起：{task.blocked_reason}
                            </div>
                          )}
                          {(task.model || task.reasoning_effort) && (
                            <div className="sm:col-span-2">
                              模型：{task.model ?? '默认'}{task.reasoning_effort ? ` · 思考 ${task.reasoning_effort}` : ''}
                            </div>
                          )}
                          {!!task.resource_revision && (
                            <div className="sm:col-span-2">资源版本：{task.resource_revision}</div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/50 pt-3">
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggleEnabled(task)}>
                            {toggling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {task.enabled ? '暂停' : '恢复'}
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => openHistory(task)}>
                            运行历史
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setView({ kind: 'resources', task })}>
                            <Package className="h-3.5 w-3.5" /> 资源
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Pagination
                offset={tasksQuery.data?.offset ?? offset}
                limit={tasksQuery.data?.limit ?? SCHEDULED_TASK_PAGE_SIZE}
                itemCount={tasks.length}
                isFetching={tasksQuery.isFetching}
                onChange={setOffset}
              />
            </div>
          )}

          {(view.kind === 'create' || view.kind === 'edit') && (
            <TaskForm
              key={view.kind === 'edit' ? view.task.task_id : 'create'}
              task={view.kind === 'edit' ? view.task : undefined}
              pending={createMutation.isPending || updateMutation.isPending}
              onCancel={() => setView({ kind: 'list' })}
              onSave={saveDraft}
            />
          )}

          {view.kind === 'runs' && (
            <div className="space-y-3">
              <Button variant="ghost" size="sm" onClick={() => setView({ kind: 'list' })}>
                <ArrowLeft className="h-3.5 w-3.5" /> 返回任务列表
              </Button>
              {cancelMutation.error && (
                <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMessage(cancelMutation.error)}
                </div>
              )}
              {runsQuery.isLoading ? (
                <ListSkeleton />
              ) : runsQuery.error ? (
                <QueryError error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
              ) : runs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-foreground/15 px-4 py-12 text-center text-sm text-muted-foreground">
                  {runOffset > 0 ? '这一页没有执行记录' : '还没有执行记录'}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {runs.map((run) => (
                    <RunRow
                      key={run.occurrence_id}
                      run={run}
                      cancelPending={
                        cancelMutation.isPending && cancelMutation.variables?.runId === run.run_id
                      }
                      onOpenSession={openSession}
                      onCancel={cancelRun}
                    />
                  ))}
                </ul>
              )}
              <Pagination
                offset={runsQuery.data?.offset ?? runOffset}
                limit={runsQuery.data?.limit ?? SCHEDULED_TASK_PAGE_SIZE}
                itemCount={runs.length}
                isFetching={runsQuery.isFetching}
                onChange={setRunOffset}
              />
            </div>
          )}

          {view.kind === 'session' && (
            <ScheduledSessionView
              sessionId={view.sessionId}
              poll={view.poll}
              onBack={() => setView({ kind: 'runs', task: view.task })}
            />
          )}

          {view.kind === 'resources' && (
            <ScheduledResourcesView
              task={
                // 绑定 PATCH 的 CAS 需要最新 revision：优先取轮询中的实时行，回落到点击快照。
                tasks.find((item) => item.task_id === view.task.task_id) ?? view.task
              }
              onBack={() => setView({ kind: 'list' })}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskForm({
  task,
  pending,
  onCancel,
  onSave,
}: {
  task?: ScheduledTask;
  pending: boolean;
  onCancel: () => void;
  onSave: (draft: ScheduledTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ScheduledTaskDraft>(() =>
    task ? scheduledTaskToDraft(task) : emptyScheduledTaskDraft()
  );
  const [error, setError] = useState<string | null>(null);
  const modelsQuery = useModels();
  const models = modelsQuery.data?.models ?? [];
  const showModelControls = models.length > 1;
  const effectiveModel =
    models.find((model) => model.name === draft.model) ??
    models.find((model) => model.name === modelsQuery.data?.default);

  const change = <K extends keyof ScheduledTaskDraft>(key: K, value: ScheduledTaskDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const changeScheduleType = (scheduleType: ScheduledTaskDraft['scheduleType']) => {
    setDraft((current) => ({
      ...current,
      scheduleType,
      timezone: scheduleType === 'at' ? browserTimeZone() : current.timezone || browserTimeZone(),
    }));
    setError(null);
  };

  const changeModel = (modelName: string) => {
    setDraft((current) => {
      const selected = models.find((model) => model.name === modelName);
      const mustReduceEffort = selected && !selected.thinking && current.effort && current.effort !== 'none';
      return {
        ...current,
        model: modelName,
        effort: mustReduceEffort ? (task?.reasoning_effort ? 'none' : '') : current.effort,
      };
    });
    setError(null);
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (pending) return;
    if (showModelControls && effectiveModel && !effectiveModel.thinking && draft.effort && draft.effort !== 'none') {
      setError('当前模型不支持思考，请将思考等级改为 none 或默认值');
      return;
    }
    setError(null);
    try {
      await onSave(draft);
    } catch (cause) {
      // 校验或请求失败都只更新错误，不重建草稿。
      setError(errorMessage(cause));
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="任务名称" htmlFor="scheduled-task-name">
          <Input id="scheduled-task-name" autoFocus maxLength={255} value={draft.name} onChange={(event) => change('name', event.target.value)} placeholder="例如：每日工作日报" />
        </Field>
        <Field label="计划类型" htmlFor="scheduled-task-type">
          <select id="scheduled-task-type" className={SELECT_CLASS} value={draft.scheduleType} onChange={(event) => changeScheduleType(event.target.value as ScheduledTaskDraft['scheduleType'])}>
            <option value="at">单次执行</option>
            <option value="cron">周期执行（cron）</option>
          </select>
        </Field>
      </div>

      <Field label="执行指令" htmlFor="scheduled-task-prompt">
        <Textarea id="scheduled-task-prompt" className="min-h-28 resize-y" value={draft.prompt} onChange={(event) => change('prompt', event.target.value)} placeholder="Agent 到点后要执行的完整指令" />
      </Field>

      {draft.scheduleType === 'at' ? (
        <Field label={`执行时间（浏览器时区：${browserTimeZone()}）`} htmlFor="scheduled-task-at" hint="单次时间按当前设备时区解释，保存为带偏移的 RFC3339 时间。">
          <Input id="scheduled-task-at" type="datetime-local" step={60} value={draft.runAt} onChange={(event) => change('runAt', event.target.value)} />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="五字段 cron" htmlFor="scheduled-task-cron" hint="例如 30 9 * * *；不支持秒、宏或 @every。">
            <Input id="scheduled-task-cron" className="font-mono" value={draft.expression} onChange={(event) => change('expression', event.target.value)} placeholder="30 9 * * *" />
          </Field>
          <Field label="IANA 时区" htmlFor="scheduled-task-timezone">
            <Input id="scheduled-task-timezone" className="font-mono" value={draft.timezone} onChange={(event) => change('timezone', event.target.value)} placeholder="Asia/Shanghai" />
          </Field>
        </div>
      )}

      {/* 1.3.0 起 existing 策略退役：新建固定独立会话（不渲染选择器）；仅旧任务
          编辑时提供迁移到 new 的入口。 */}
      {task?.session.mode === 'existing' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="会话策略"
            htmlFor="scheduled-task-session-mode"
            hint="“既有会话”策略已停用：任务保持暂停，切换为独立会话后才会恢复执行。"
          >
            <select id="scheduled-task-session-mode" className={SELECT_CLASS} value={draft.sessionMode} onChange={(event) => change('sessionMode', event.target.value as ScheduledTaskDraft['sessionMode'])}>
              <option value="existing">既有会话（旧策略，已停用）</option>
              <option value="new">每次创建独立会话</option>
            </select>
          </Field>
          {draft.sessionMode === 'existing' && (
            <Field label="目标会话（只读）" htmlFor="scheduled-task-session-id">
              <Input id="scheduled-task-session-id" className="font-mono" value={draft.sessionId} readOnly disabled />
            </Field>
          )}
        </div>
      )}

      {modelsQuery.error && (
        <p className="text-xs text-amber-700">模型目录加载失败；可保留当前模型配置并修改其他字段。</p>
      )}
      {showModelControls ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="模型" htmlFor="scheduled-task-model">
            <select id="scheduled-task-model" className={SELECT_CLASS} value={draft.model} onChange={(event) => changeModel(event.target.value)}>
              {!task?.model && <option value="">默认（按部署配置）</option>}
              {draft.model && !models.some((model) => model.name === draft.model) && (
                <option value={draft.model}>{draft.model}（当前）</option>
              )}
              {models.map((model) => (
                <option key={model.name} value={model.name}>{model.name}</option>
              ))}
            </select>
          </Field>
          <Field label="思考等级" htmlFor="scheduled-task-effort">
            <select id="scheduled-task-effort" className={SELECT_CLASS} value={draft.effort} onChange={(event) => change('effort', event.target.value as ScheduledTaskDraft['effort'])}>
              {!task?.reasoning_effort && <option value="">默认（按部署配置）</option>}
              {EFFORTS.map((effort) => (
                <option key={effort} value={effort} disabled={!effectiveModel?.thinking && effort !== 'none'}>
                  {effort}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : (draft.model || draft.effort) && (
        <p className="text-xs text-muted-foreground">
          当前模型配置：{draft.model || '默认'}{draft.effort ? ` · 思考 ${draft.effort}` : ''}（目录不可修改）
        </p>
      )}
      {(task?.model || task?.reasoning_effort) && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          当前接口不支持把已显式选择的模型或思考等级清除为“默认”，可保留或切换为其他具体值。
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
          {error}
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-white/50 pt-4">
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {task ? '保存修改' : '创建任务'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RunRow({
  run,
  cancelPending,
  onOpenSession,
  onCancel,
}: {
  run: ScheduledTaskRun;
  cancelPending: boolean;
  onOpenSession: (run: ScheduledTaskRun) => void;
  onCancel: (run: ScheduledTaskRun) => void;
}) {
  const active = isRunActive(run.status);
  return (
    <li className="rounded-2xl border border-white/60 bg-white/40 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-medium',
          run.status === 'succeeded' && 'bg-emerald-500/10 text-emerald-700',
          (run.status === 'error' || run.status === 'interrupted') && 'bg-destructive/10 text-destructive',
          active && 'bg-primary/10 text-primary',
          (run.status === 'skipped' || run.status === 'cancelled') && 'bg-foreground/[0.07] text-muted-foreground'
        )}>
          {RUN_STATUS_LABELS[run.status]}
        </span>
        <span className="text-xs font-medium text-foreground">计划 {formatDateTime(run.scheduled_for)}</span>
        {active && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={cancelPending || !run.session_id}
            title="取消后端本次运行中的 Turn"
            onClick={() => void onCancel(run)}
          >
            {cancelPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />} 取消
          </Button>
        )}
        <Button
          className="ml-auto"
          variant="ghost"
          size="sm"
          onClick={() => onOpenSession(run)}
          disabled={!run.session_id || run.content_deleted}
          title={run.content_deleted ? '任务会话内容已被删除，仅保留执行事实' : undefined}
        >
          <MessageSquare className="h-3.5 w-3.5" /> {run.content_deleted ? '内容已删除' : '查看会话'}
        </Button>
      </div>
      <div className="mt-2 grid gap-1 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-2">
        <span>开始：{formatDateTime(run.started_at)}</span>
        <span>结束：{formatDateTime(run.finished_at)}</span>
        {run.next_attempt_at && <span>下次重试：{formatDateTime(run.next_attempt_at)}</span>}
        {run.attempt_count > 0 && <span>启动前尝试：{run.attempt_count} 次</span>}
        <span className="break-all sm:col-span-2">会话：{run.session_id || '—'}</span>
      </div>
      {run.reason && <p className="mt-2 text-xs text-amber-700">{RUN_REASON_LABELS[run.reason]}</p>}
      {run.error && <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-destructive/[0.06] p-2 text-xs text-destructive">{run.error}</p>}
    </li>
  );
}

// 任务会话只读视图：复用普通聊天的持久化分组与渲染组件（同一读模型），仅数据源
// 换成 scheduled-sessions 端点；无发送框、无流式段。子 Agent 浮窗的懒加载端点
// 属普通会话，任务会话下点击将加载失败——已知降级。
function ScheduledSessionView({
  sessionId,
  poll,
  onBack,
}: {
  sessionId: string;
  poll: boolean;
  onBack: () => void;
}) {
  const messagesQuery = useScheduledSessionMessages(sessionId, true, poll);
  const messages = useMemo(() => messagesQuery.data?.messages ?? [], [messagesQuery.data]);
  const blocks = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> 返回执行历史
        </Button>
        <span className="break-all text-[11px] text-muted-foreground">{sessionId}</span>
      </div>
      {messagesQuery.isLoading ? (
        <ListSkeleton />
      ) : messagesQuery.error ? (
        <QueryError error={messagesQuery.error} onRetry={() => void messagesQuery.refetch()} />
      ) : blocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-foreground/15 px-4 py-12 text-center text-sm text-muted-foreground">
          暂无消息
        </div>
      ) : (
        <div>
          {blocks.map((block) => (
            <div key={block.id} className="py-1.5">
              <ChatMessage sessionId={sessionId} block={block} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// 任务资源（.cron）视图：草稿在工作区 .cron 命名空间下用普通文件端点编辑；这里
// 只做元数据展示、发布（幂等 request_id + CAS 草稿栅栏）与版本绑定/解绑。
function ScheduledResourcesView({ task, onBack }: { task: ScheduledTask; onBack: () => void }) {
  const resourcesQuery = useScheduledTaskResources(task.task_id, true);
  const publishMutation = usePublishScheduledTaskResources();
  const updateMutation = useUpdateScheduledTask();
  // 发布幂等键：一次发布意图一个键，失败重试复用（后端重放同一 revision）。
  const [requestId, setRequestId] = useState<string | null>(null);

  const publish = async () => {
    publishMutation.reset();
    updateMutation.reset();
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    try {
      const published = await publishMutation.mutateAsync({
        taskId: task.task_id,
        requestId: id,
        expectedDraftRevision: resourcesQuery.data?.draft_revision,
      });
      await updateMutation.mutateAsync({
        taskId: task.task_id,
        patch: buildResourceBindPatch(task, published),
      });
      setRequestId(null);
    } catch {
      // 错误在视图内展示，requestId 保留供重试幂等。
    }
  };

  const bind = async (version: ScheduledResourceVersion) => {
    updateMutation.reset();
    try {
      await updateMutation.mutateAsync({
        taskId: task.task_id,
        patch: { resource_revision: version.resource_revision, manifest_hash: version.manifest_hash },
      });
    } catch {
      // mutation.error 在视图内展示。
    }
  };

  const clearBinding = async () => {
    updateMutation.reset();
    try {
      await updateMutation.mutateAsync({ taskId: task.task_id, patch: { resource_revision: 0 } });
    } catch {
      // mutation.error 在视图内展示。
    }
  };

  const files = resourcesQuery.data?.files ?? [];
  const versions = resourcesQuery.data?.versions ?? [];
  const bound = !!task.resource_revision;
  const actionError = publishMutation.error ?? updateMutation.error;
  const pending = publishMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" /> 返回任务列表
      </Button>
      {actionError && (
        <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
          {errorMessage(actionError)}
        </div>
      )}
      {resourcesQuery.isLoading ? (
        <ListSkeleton />
      ) : resourcesQuery.error ? (
        <QueryError error={resourcesQuery.error} onRetry={() => void resourcesQuery.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/60 bg-white/40 p-3.5 text-xs text-muted-foreground">
            <p>
              当前绑定：{bound ? `版本 ${task.resource_revision}` : '未绑定（执行时不注入任何 .cron 资源）'}
              {bound && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-7 px-2 text-xs"
                  disabled={pending}
                  onClick={() => void clearBinding()}
                >
                  清除绑定
                </Button>
              )}
            </p>
            <p className="mt-1.5 leading-relaxed">
              草稿文件在工作区 <span className="font-mono">.cron</span> 命名空间下通过文件面板编辑；发布后版本不可变，执行时按绑定的版本注入。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending || files.length === 0} onClick={() => void publish()}>
                {(publishMutation.isPending || updateMutation.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                发布草稿为新版本
              </Button>
              <span className="text-[11px]">
                草稿 {files.length} 个文件 · {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
              </span>
            </div>
            {files.length === 0 && (
              <p className="mt-1.5 text-[11px]">暂无草稿文件：先在文件面板向任务的 .cron 目录添加文件。</p>
            )}
          </div>

          {files.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium text-foreground">草稿文件</h3>
              <ul className="space-y-1">
                {files.map((file) => (
                  <li key={file.path} className="flex items-baseline justify-between gap-2 rounded-xl bg-white/40 px-3 py-1.5 text-xs">
                    <span className="min-w-0 break-all font-mono text-[11px]">{file.path}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-medium text-foreground">已发布版本</h3>
            {versions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-foreground/15 px-3 py-6 text-center text-xs text-muted-foreground">
                还没有发布过版本
              </p>
            ) : (
              <ul className="space-y-1.5">
                {versions.map((version) => (
                  <li key={version.resource_revision} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/40 px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">版本 {version.resource_revision}</span>
                    <span className="text-muted-foreground">
                      {version.file_count} 个文件 · {formatBytes(version.total_bytes)} · {formatDateTime(version.create_time)}
                    </span>
                    <span className="break-all font-mono text-[10px] text-muted-foreground">{version.manifest_hash.slice(0, 12)}…</span>
                    {task.resource_revision === version.resource_revision ? (
                      <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700">当前绑定</span>
                    ) : (
                      <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" disabled={pending} onClick={() => void bind(version)}>
                        绑定
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({
  offset,
  limit,
  itemCount,
  isFetching,
  onChange,
}: {
  offset: number;
  limit: number;
  itemCount: number;
  isFetching: boolean;
  onChange: (offset: number) => void;
}) {
  if (offset === 0 && !hasNextPage(itemCount, limit)) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/50 pt-3">
      <Button variant="ghost" size="sm" disabled={offset === 0 || isFetching} onClick={() => onChange(Math.max(0, offset - limit))}>
        <ChevronLeft className="h-3.5 w-3.5" /> 上一页
      </Button>
      <span className="text-[11px] text-muted-foreground">
        第 {Math.floor(offset / Math.max(1, limit)) + 1} 页{isFetching ? ' · 更新中…' : ''}
      </span>
      <Button variant="ghost" size="sm" disabled={!hasNextPage(itemCount, limit) || isFetching} onClick={() => onChange(offset + limit)}>
        下一页 <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5" aria-label="正在加载">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-36 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-destructive/[0.06] px-4 py-8 text-center">
      <p className="text-xs text-destructive">{errorMessage(error)}</p>
      <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>重试</Button>
    </div>
  );
}
