import { memo, useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolArg {
  key: string;
  value: unknown;
}

export interface ParsedToolCall {
  /** 工具名；无法识别时为空串。 */
  name: string;
  args: ToolArg[];
}

const NAME_KEYS = ['name', 'tool', 'tool_name', 'toolName'];
const ARGS_KEYS = ['args', 'arguments', 'parameters', 'params', 'input'];

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function pickName(obj: Record<string, unknown>): string {
  const fn = obj.function;
  if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
    const fname = (fn as Record<string, unknown>).name;
    if (typeof fname === 'string' && fname.trim()) return fname.trim();
  }
  for (const k of NAME_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// 把任意「参数来源」规整为键值列表。参数有时被二次序列化为 JSON 字符串，
// 这里顺带再解一层；纯字符串/数组等无键结构返回空，避免误展示。
function toArgList(src: unknown): ToolArg[] {
  if (src == null) return [];
  if (typeof src === 'string') {
    const inner = tryJson(src);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return toArgList(inner);
    }
    return [];
  }
  if (Array.isArray(src) || typeof src !== 'object') return [];
  return Object.entries(src as Record<string, unknown>).map(([key, value]) => ({ key, value }));
}

// 将 tool_call 的 content（JSON 字符串 / 函数调用串 / 纯工具名）解析为
// { name, args }。对未知结构保持健壮：解析失败时回退为整串当工具名展示。
export function parseToolCall(raw: string): ParsedToolCall {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { name: '', args: [] };

  const parsed = tryJson(trimmed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const name = pickName(obj);

    const explicitKey = ARGS_KEYS.find((k) => obj[k] !== undefined);
    if (explicitKey !== undefined) {
      return { name, args: toArgList(obj[explicitKey]) };
    }
    const fnObj =
      obj.function && typeof obj.function === 'object' && !Array.isArray(obj.function)
        ? (obj.function as Record<string, unknown>)
        : undefined;
    if (fnObj && fnObj.arguments !== undefined) {
      return { name, args: toArgList(fnObj.arguments) };
    }

    // 无显式参数字段：把除名称/函数键外的其余字段视作参数。
    const ignore = new Set<string>([...NAME_KEYS, ...ARGS_KEYS, 'function']);
    const rest = Object.entries(obj).filter(([k]) => !ignore.has(k));
    return { name, args: rest.map(([key, value]) => ({ key, value })) };
  }

  // 回退：整串当作工具名（去掉首尾包裹的引号）。
  return { name: stripQuotes(trimmed), args: [] };
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// 标量值内联展示；多行/长字符串/对象数组用等宽块展示，保持可读性。
function formatValue(value: unknown): { text: string; block: boolean } {
  if (value === null) return { text: 'null', block: false };
  if (typeof value === 'string') {
    return value.includes('\n') || value.length > 60
      ? { text: value, block: true }
      : { text: value, block: false };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { text: String(value), block: false };
  }
  return { text: JSON.stringify(value, null, 2), block: true };
}

/**
 * 把 tool_call 的 content（通常是 JSON）解析成「工具名 + 参数键值」，
 * 以一张玻璃质感卡片呈现，替代直接堆原始 JSON 文本。
 */
export const ToolCallBubble = memo(function ToolCallBubble({ raw }: { raw: string }) {
  const { name, args } = useMemo(() => parseToolCall(raw), [raw]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/50 bg-white/40 backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-white/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <Wrench className="h-3 w-3 shrink-0" />
        <span>工具调用</span>
        {name && (
          <>
            <span className="text-foreground/40">·</span>
            <span className="truncate font-mono text-foreground">{name}</span>
          </>
        )}
      </div>
      {args.length > 0 ? (
        <dl className="space-y-1.5 px-3 py-2">
          {args.map(({ key, value }) => {
            const { text, block } = formatValue(value);
            return (
              <div key={key} className="space-y-0.5">
                <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
                <dd
                  className={cn(
                    'text-xs text-foreground',
                    block
                      ? 'whitespace-pre-wrap break-words rounded-lg bg-black/[0.04] px-2 py-1 font-mono leading-relaxed'
                      : 'break-words font-mono'
                  )}
                >
                  {text}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="px-3 py-2 text-xs text-muted-foreground">无参数</div>
      )}
    </div>
  );
});
