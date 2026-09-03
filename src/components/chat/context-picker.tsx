import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, File, Folder, Loader2, Search } from 'lucide-react';
import { useMcpTools, useSkills } from '@/hooks/use-catalogue';
import { useWorkspace, useWorkspaceSearch } from '@/hooks/use-workspace';
import type { AttachmentItem } from '@/lib/additional-context';
import { cn } from '@/lib/utils';

// ContextPicker——附加上下文选择弹层（message-context-mentions）。
// 唯一组件、三种唤起（design D2）：`@` 触发（files 分组）、`/` 触发与「技能/工具」
// 常驻按钮（tools 分组）。弹层锚定输入区上方渲染（类 Slack mention 列表），不跟随
// 光标逐字符定位——caret 定位的收益不抵其复杂度。
//
// 列表数据在组件内解析后经 onItemsResolved 上抛，键盘导航（↑↓/Enter）由父级
// （message-input 的 textarea onKeyDown）驱动 activeIndex——textarea 保持焦点，
// 弹层不抢焦，行 onMouseDown preventDefault 防止点击行时 textarea 先失焦导致弹层销毁。

export type PickerTab = 'files' | 'tools';

export interface PickerEntry {
  item: AttachmentItem;
  label: string;
  /** 次要文案：搜索命中的父目录 / mcp server。 */
  sublabel?: string;
  description?: string;
}

interface ContextPickerProps {
  tab: PickerTab;
  /** 触发查询串；按钮模式下为空串（不过滤）。 */
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onItemsResolved: (entries: PickerEntry[]) => void;
  onSelect: (entry: PickerEntry) => void;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

// 文件分组：空查询 = 浏览模式（useWorkspace 列目录，目录行可下钻）；非空 = 搜索模式
// （useWorkspaceSearch 内置防抖，命中全工作区）。与侧边栏文件树的双模式口径一致
// （design D9），零新 hook；truncated 提示沿用侧边栏文案。
function FileEntries({
  query,
  activeIndex,
  onActiveIndexChange,
  onItemsResolved,
  onSelect,
}: {
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onItemsResolved: (entries: PickerEntry[]) => void;
  onSelect: (entry: PickerEntry) => void;
}) {
  const [dir, setDir] = useState('');
  const searching = query.trim() !== '';
  const search = useWorkspaceSearch(query);
  const listing = useWorkspace(dir);

  const entries = useMemo<PickerEntry[]>(() => {
    if (searching) {
      return search.entries.map((entry) => ({
        item: { kind: entry.type === 'dir' ? 'dir' : 'file', path: entry.path },
        label: entry.name,
        sublabel: dirname(entry.path) || undefined,
      }));
    }
    return listing.files.map((entry) => ({
      item: { kind: entry.type === 'dir' ? 'dir' : 'file', path: dir ? `${dir}/${entry.name}` : entry.name },
      label: entry.name,
      sublabel: entry.type === 'dir' ? undefined : dir || undefined,
    }));
  }, [searching, search.entries, listing.files, dir]);

  useEffect(() => {
    onItemsResolved(entries);
  }, [entries, onItemsResolved]);

  if (search.isSearching || listing.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="px-3 py-2.5 text-xs text-muted-foreground">
        {searching ? '无匹配结果' : '暂无文件'}
      </div>
    );
  }

  return (
    <>
      <div className="max-h-64 overflow-y-auto p-1">
        {entries.map((entry, index) => {
          const isDir = entry.item.kind === 'dir';
          return (
            <div
              key={`${entry.item.kind}:${entry.item.path}`}
              className={cn(
                'group relative flex items-center rounded-xl px-2 py-1.5 text-sm transition-colors',
                index === activeIndex ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
              )}
              onMouseEnter={() => onActiveIndexChange(index)}
            >
              {/* 浏览模式的目录行以左缘 chevron 下钻；点击行本体仍是附加（spec「点击列表项即附加」）。 */}
              {isDir && !searching && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setDir(entry.item.path ?? '')}
                  className="mr-1 shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                  title="打开目录"
                  aria-label={`打开目录 ${entry.label}`}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              {isDir ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <File className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(entry)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left"
              >
                <span className="truncate">{entry.label}</span>
                {entry.sublabel && (
                  <span className="ml-auto max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
                    {entry.sublabel}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      {searching && search.truncated && (
        <div className="border-t border-white/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          匹配较多，仅显示前 {entries.length} 条，可输入更精确的关键词
        </div>
      )}
      {!searching && dir && (
        <div className="flex items-center gap-1 border-t border-white/40 px-2 py-1 text-[11px] text-muted-foreground">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setDir(dirname(dir))}
            className="rounded-sm px-1 py-0.5 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            返回上级
          </button>
          <span className="truncate">/{dir}</span>
        </div>
      )}
    </>
  );
}

// tools 分组：Skills 与 MCP 工具两组列表（chat-panel 头部 catalogue 的行形态），
// 按名称/server/描述子串过滤（catalogue 量级小，客户端过滤即可）。
function ToolEntries({
  query,
  activeIndex,
  onActiveIndexChange,
  onItemsResolved,
  onSelect,
}: {
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onItemsResolved: (entries: PickerEntry[]) => void;
  onSelect: (entry: PickerEntry) => void;
}) {
  const skillsQuery = useSkills();
  const toolsQuery = useMcpTools();
  const kw = query.trim().toLowerCase();

  // 分组各自构建后再拼接：skill 段长度单独持有，过滤后分组边界才不会错位。
  const { entries, skillCount } = useMemo(() => {
    const match = (text: string) => !kw || text.toLowerCase().includes(kw);
    const skills = (skillsQuery.data?.skills ?? [])
      .filter((s) => match(s.name))
      .map<PickerEntry>((s) => ({ item: { kind: 'skill', name: s.name }, label: s.name }));
    const tools = (toolsQuery.data?.tools ?? [])
      .filter((t) => match(`${t.name} ${t.server} ${t.description ?? ''}`))
      .map<PickerEntry>((t) => ({
        item: { kind: 'mcp', name: t.name, server: t.server },
        label: t.name,
        sublabel: `@${t.server}`,
        description: t.description || undefined,
      }));
    return { entries: [...skills, ...tools], skillCount: skills.length };
  }, [skillsQuery.data, toolsQuery.data, kw]);

  useEffect(() => {
    onItemsResolved(entries);
  }, [entries, onItemsResolved]);

  if (skillsQuery.isLoading || toolsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="px-3 py-2.5 text-xs text-muted-foreground">暂无匹配的技能或工具</div>;
  }

  return (
    <div className="max-h-64 overflow-y-auto p-1">
      {skillsQuery.data?.skills.length ? (
        <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
          技能
        </div>
      ) : null}
      {entries.slice(0, skillCount).map((entry, index) => (
        <PickerRow
          key={`skill:${entry.label}`}
          entry={entry}
          active={index === activeIndex}
          onHover={() => onActiveIndexChange(index)}
          onSelect={() => onSelect(entry)}
        />
      ))}
      {toolsQuery.data?.tools.length ? (
        <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
          MCP 工具
        </div>
      ) : null}
      {entries.slice(skillCount).map((entry, index) => (
        <PickerRow
          key={`mcp:${entry.label}:${entry.item.server}`}
          entry={entry}
          active={skillCount + index === activeIndex}
          onHover={() => onActiveIndexChange(skillCount + index)}
          onSelect={() => onSelect(entry)}
        />
      ))}
    </div>
  );
}

function PickerRow({
  entry,
  active,
  onHover,
  onSelect,
}: {
  entry: PickerEntry;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const isMcp = entry.item.kind === 'mcp';
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors',
        active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
      )}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        className="min-w-0 flex-1 rounded-lg text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-xs font-medium', isMcp && 'font-mono')}>
            {entry.label}
          </span>
          {entry.sublabel && (
            <span className="truncate text-[11px] text-muted-foreground">{entry.sublabel}</span>
          )}
        </div>
        {entry.description && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {entry.description}
          </div>
        )}
      </button>
    </div>
  );
}

// 弹层面板：锚定输入区上方；查询非空时展示过滤口径提示。activeIndex 与列表由父级持有。
export function ContextPicker(props: ContextPickerProps) {
  const { tab, query } = props;
  return (
    <div className="glass-strong absolute bottom-full left-0 right-0 z-50 mb-2 rounded-xl p-1 shadow-lg">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Search className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {tab === 'files' ? '选择工作区文件或目录' : '选择技能或 MCP 工具'}
        </span>
        <span className="ml-auto shrink-0">↑↓ 选择 · Enter 附加 · Esc 关闭</span>
      </div>
      {tab === 'files' ? (
        <FileEntries
          query={query}
          activeIndex={props.activeIndex}
          onActiveIndexChange={props.onActiveIndexChange}
          onItemsResolved={props.onItemsResolved}
          onSelect={props.onSelect}
        />
      ) : (
        <ToolEntries
          query={query}
          activeIndex={props.activeIndex}
          onActiveIndexChange={props.onActiveIndexChange}
          onItemsResolved={props.onItemsResolved}
          onSelect={props.onSelect}
        />
      )}
    </div>
  );
}
