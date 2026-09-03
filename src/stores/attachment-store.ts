import { create } from 'zustand';
import {
  dedupeItems,
  dedupeReferences,
  type AttachmentItem,
  type QuotedReference,
} from '@/lib/additional-context';

// 待发送附件 chips 与划词引用（message-context-mentions）。用 Zustand 而非输入组件
// 本地 state：写入方跨组件——侧边栏文件树的 hover「+」按钮、拖拽 drop、picker、
// 常驻按钮、消息区划词浮层都在输入区之外，chips 条与序列化消费方在输入区。
// 切换会话不清空；发送成功 clear、请求级失败 restore，时机由输入区控制。
interface AttachmentState {
  items: AttachmentItem[];
  addItem: (item: AttachmentItem) => void;
  references: QuotedReference[];
  addReference: (reference: QuotedReference) => void;
  removeAt: (index: number) => void;
  removeReferenceAt: (index: number) => void;
  clear: () => void;
  restore: (items: AttachmentItem[], references?: QuotedReference[]) => void;
}

export const useAttachmentStore = create<AttachmentState>()((set) => ({
  items: [],
  references: [],
  // 去重在插入时做（design D8）：重复附加同一条目无感，序列化只做映射不再过滤。
  addItem: (item) => set((s) => ({ items: dedupeItems([...s.items, item]) })),
  addReference: (reference) => {
    const value = reference.text.trim();
    if (value === '' || !Number.isSafeInteger(reference.turn) || reference.turn < 0) return;
    set((s) => ({
      references: dedupeReferences([...s.references, { ...reference, text: value }]),
    }));
  },
  removeAt: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
  removeReferenceAt: (index) =>
    set((s) => ({ references: s.references.filter((_, i) => i !== index) })),
  clear: () => set({ items: [], references: [] }),
  restore: (items, references = []) =>
    set({ items: dedupeItems(items), references: dedupeReferences(references) }),
}));
