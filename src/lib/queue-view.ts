import type { SessionQueueEntry, AttachmentRef } from '@/lib/api';
import type { QueueConfirmItem } from '@/stores/pending-queue-store';

// session-message-queue 等待列表的纯对齐逻辑（adapt-session-message-queue D3）：
// 服务端 FIFO 快照 + 本地临时确认项 → 展示项列表。抽取为纯函数供回归覆盖
//（去重 / 接管 / FIFO 序 / 活跃 run 退出等待展示）。

/** 等待展示项：服务端快照与临时确认项的归一形态。 */
export interface PendingQueueItem {
  runId: string;
  /** 发送原文（含 additional_context 序列化块，展示侧解析剥离）。 */
  content: string;
  /** 已知模型（快照为服务端解析名，确认为请求值）。 */
  model?: string;
  /** 入队时间（快照为 RFC3339；确认为本地 ms 时间戳，展示侧归一）。 */
  enqueuedAt: string | number;
  attachments?: AttachmentRef[];
  source: 'server' | 'confirm';
}

/**
 * 合并等待列表：服务端顺序为准、run id 去重（快照项优先于同 id 的确认项——
 * 「随后由队列快照接管」），未被快照覆盖的确认项按确认顺序续在尾部（FIFO：
 * 确认总晚于此前所有已见快照项）。activeRunId 匹配的项已开始执行，退出等待
 * 展示（由实时输出与历史接管，不重复气泡）。queue_position 只是入队参考值，
 * 不作为排序依据。
 */
export function mergeQueueView(
  entries: SessionQueueEntry[],
  confirms: QueueConfirmItem[],
  activeRunId: string | null
): PendingQueueItem[] {
  const seen = new Set<string>();
  const items: PendingQueueItem[] = [];
  for (const entry of entries) {
    if (seen.has(entry.run_id)) continue;
    seen.add(entry.run_id);
    items.push({
      runId: entry.run_id,
      content: entry.content,
      model: entry.model,
      enqueuedAt: entry.enqueued_at,
      attachments: entry.attachments,
      source: 'server',
    });
  }
  for (const confirm of confirms) {
    if (seen.has(confirm.runId)) continue;
    seen.add(confirm.runId);
    items.push({
      runId: confirm.runId,
      content: confirm.content,
      model: confirm.model,
      enqueuedAt: confirm.at,
      attachments: confirm.attachments,
      source: 'confirm',
    });
  }
  return activeRunId ? items.filter((item) => item.runId !== activeRunId) : items;
}

/** 确认项的快照接管保留谓词：在最新快照中，或尚在接管宽限期内。 */
export function shouldKeepConfirm(
  confirm: QueueConfirmItem,
  snapshotIds: ReadonlySet<string>,
  now: number,
  graceMs = 3000
): boolean {
  return snapshotIds.has(confirm.runId) || now - confirm.at < graceMs;
}
