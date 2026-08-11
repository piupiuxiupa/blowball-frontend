import { memo, useMemo, useState } from 'react';
import { ChevronDown, Wrench, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolArg {
  key: string;
  value: unknown;
}

export interface ParsedToolCall {
  /** 工具名；无法识别时为空串。 */
  name: string;
  args: ToolArg[];
  /** 工具执行出错（output.status / status === 1）。 */
  isError?: boolean;
  /** 工具结果记录（含 output），与「工具调用」区分，头部文案不同。 */
  isResult?: boolean;
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

// 后端工具结果的 status：0=正常，1=错误（见 openapi SSEToolResult）。兼容数字 / 字符串。
function isStatusError(s: unknown): boolean {
  return s === 1 || s === '1';
}

// 从「工具结果」记录提取展示数据。兼容两种 content 形态（均无工具名 / 参数键）：
//   · 顶层状态信封（registry 工具，openapi SSEToolResult）：{status, result?} / {status:1, error?}
//   · 嵌套包裹（历史 / 持久化兼容）：{output:{result,status}, tool_call_id}
// 返回 null 表示这不是工具结果记录（按工具调用处理）。
function parseResultRecord(
  obj: Record<string, unknown>,
): { args: ToolArg[]; isError: boolean } | null {
  const noNameNoArgs = pickName(obj) === '' && ARGS_KEYS.every((k) => obj[k] === undefined);

  // 顶层状态信封：status 伴随 result 或 error。
  if (
    noNameNoArgs &&
    obj.status !== undefined &&
    (obj.result !== undefined || obj.error !== undefined)
  ) {
    const isError = isStatusError(obj.status);
    const key = isError ? 'error' : 'result';
    const value = isError ? obj.error : obj.result;
    return { args: value === undefined ? [] : [{ key, value }], isError };
  }

  // 嵌套包裹（持久化 tool_result）：{output:{result|error, tool_call_id}}。
  // 可能带 status；若无 status，以 output.error 是否存在判定出错（成功带 result，失败带 error）。
  const output = obj.output;
  if (noNameNoArgs && output && typeof output === 'object' && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    const isError = o.status !== undefined ? isStatusError(o.status) : o.error !== undefined;
    const key = isError ? 'error' : 'result';
    const value = isError ? o.error : o.result;
    if (value !== undefined) return { args: [{ key, value }], isError };
  }

  return null;
}

// 将 tool_call / tool_result 的 content（JSON 字符串 / 函数调用串 / 纯工具名）解析为
// { name, args, isError, isResult }。对未知结构保持健壮：解析失败时回退为整串当工具名展示。
export function parseToolCall(raw: string): ParsedToolCall {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { name: '', args: [] };

  const parsed = tryJson(trimmed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    // 工具结果记录（tool_result）：状态信封，含 status（0 正常 / 1 错误）。
    const result = parseResultRecord(obj);
    if (result) {
      return { name: '', args: result.args, isError: result.isError, isResult: true };
    }

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
 *
 * 默认折叠：仅显示「工具调用/工具结果 · 名字」头部，点击展开查看参数，避免长参数列表
 * 撑开正文（尤其 Confucius 连续的 invoke_* 调用）。无参数的工具调用不提供展开。
 * 工具执行出错（output.status === 1）时整卡渲染为淡红色，头部图标切换为警告。
 */
export const ToolCallBubble = memo(function ToolCallBubble({ raw }: { raw: string }) {
  const { name, args, isError, isResult } = useMemo(() => parseToolCall(raw), [raw]);
  const [collapsed, setCollapsed] = useState(true);
  const hasArgs = args.length > 0;

  const headerLabel = (
    <>
      {isError ? (
        <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
      ) : (
        <Wrench className="h-3 w-3 shrink-0" />
      )}
      <span className={isError ? 'text-destructive' : undefined}>
        {isResult ? '工具结果' : '工具调用'}
      </span>
      {name && (
        <>
          <span className="text-foreground/40">·</span>
          <span className="truncate font-mono text-foreground">{name}</span>
        </>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border backdrop-blur-md',
        isError ? 'border-red-200 bg-red-50/60' : 'border-white/50 bg-white/40',
      )}
    >
      {hasArgs ? (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className={cn(
            'flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-black/[0.03]',
            !collapsed && (isError ? 'border-b border-red-200/70' : 'border-b border-white/40')
          )}
        >
          {headerLabel}
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              !collapsed && 'rotate-180'
            )}
          />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {headerLabel}
          <span className="ml-auto text-muted-foreground/70">无参数</span>
        </div>
      )}

      {hasArgs && !collapsed && (
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
      )}
    </div>
  );
});
