import { useEffect, useState, type RefObject } from 'react';
import { Quote } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAttachmentStore } from '@/stores/attachment-store';
import type { QuotedReference } from '@/lib/additional-context';

interface QuoteSelection {
  reference: QuotedReference;
  left: number;
  top: number;
}

const BUTTON_WIDTH = 88;
const BUTTON_HEIGHT = 32;
const FLOAT_GAP = 8;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function selectionAncestor(selection: Selection): Node | null {
  if (selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  return node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
}

function nextButtonPosition(clientX: number, clientY: number) {
  const left = clamp(
    clientX - BUTTON_WIDTH / 2,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, window.innerWidth - BUTTON_WIDTH - VIEWPORT_PADDING)
  );
  const aboveTop = clientY - BUTTON_HEIGHT - FLOAT_GAP;
  const top =
    aboveTop >= VIEWPORT_PADDING
      ? aboveTop
      : clientY + FLOAT_GAP;
  return { left, top };
}

function toQuotedNode(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof Element ? node : null;
}

function readQuotedReference(
  endpoint: Node | null
): Omit<QuotedReference, 'text'> | null {
  const source = toQuotedNode(endpoint)?.closest('[data-quoted-context]');
  if (!source) return null;
  const rawTurn = source.getAttribute('data-quote-turn');
  const role = source.getAttribute('data-quote-role');
  const turn = rawTurn === null ? Number.NaN : Number(rawTurn);
  if (
    rawTurn === null ||
    !/^\d+$/.test(rawTurn) ||
    !Number.isSafeInteger(turn) ||
    (role !== 'user' && role !== 'agent')
  ) {
    return null;
  }
  return { turn, role };
}

// 消息区划词引用：pointerup 时取当前选区，在鼠标停留处给一个不抢焦的浮层按钮。
// 点击后原文进入 attachment store，由输入区 chips 统一展示并随发送序列化。
export function SelectionQuoteButton({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [quote, setQuote] = useState<QuoteSelection | null>(null);
  const addReference = useAttachmentStore((s) => s.addReference);

  useEffect(() => {
    const hide = () => setQuote(null);

    const handleMouseUp = (event: MouseEvent) => {
      const container = containerRef.current;
      const selection = window.getSelection();
      const text = selection?.toString() ?? '';
      const ancestor = selection ? selectionAncestor(selection) : null;
      // 跨消息划选时 commonAncestor 可能是列表容器；从选区端点找真正所属的消息块。
      const endpoint =
        selection && container && container.contains(selection.anchorNode)
          ? selection.anchorNode
          : (selection?.focusNode ?? null);
      const source = readQuotedReference(endpoint);
      if (
        !selection ||
        selection.isCollapsed ||
        text.trim() === '' ||
        !ancestor ||
        !container ||
        !container.contains(ancestor) ||
        !source
      ) {
        hide();
        return;
      }

      const position = nextButtonPosition(event.clientX, event.clientY);
      setQuote({ ...position, reference: { ...source, text } });
    };

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-selection-quote-button]')) return;
      hide();
    };

    const handleSelectionChange = () => {
      setQuote((current) => {
        if (!current) return current;
        const selection = window.getSelection();
        return selection?.isCollapsed ? null : current;
      });
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [containerRef]);

  if (!quote) return null;

  const quoteSelection = () => {
    addReference(quote.reference);
    window.getSelection()?.removeAllRanges();
    setQuote(null);
  };

  // 按钮必须渲染到 body：App 的玻璃面板使用 backdrop-filter，会成为 fixed 后代的
  // containing block 并被 overflow-hidden 裁剪。portal 后 viewport 坐标才是真实位置。
  return createPortal(
    <button
      type="button"
      data-selection-quote-button
      className="glass-strong fixed z-[80] flex items-center gap-1 rounded-full px-3 text-xs font-medium text-foreground shadow-lg transition-transform hover:bg-white/85 active:scale-[0.97]"
      style={{
        left: `${quote.left}px`,
        top: `${quote.top}px`,
        height: `${BUTTON_HEIGHT}px`,
        width: `${BUTTON_WIDTH}px`,
      }}
      title="引用选中内容"
      aria-label="引用选中内容"
      onMouseDown={(event) => {
        // 阻止默认可保住选区；提前入 store，点击语义不依赖后续 mouseup/click。
        event.preventDefault();
        quoteSelection();
      }}
      // 浮层由 pointer 交互打开，键盘用户仍可通过 click（Enter/Space）引用当前文案。
      onClick={quoteSelection}
    >
      <Quote className="h-3 w-3 shrink-0" />
      引用
    </button>,
    document.body
  );
}
