import { Wrench, Sparkles } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useMcpTools, useSkills } from '@/hooks/use-catalogue';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { CatalogueButton } from '@/components/chat/catalogue-button';

export function ChatPanel() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  // Tool/skill catalogues are global (not per-session), so they're available
  // to browse from the panel header even before a session is selected.
  const toolsQuery = useMcpTools();
  const skillsQuery = useSkills();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/50 bg-white/20 px-4 text-sm font-medium backdrop-blur-sm">
        <span>Agent 聊天</span>
        <div className="flex gap-1">
          <CatalogueButton
            label="可用工具"
            tooltip="查看可用工具 (Tools)"
            icon={<Wrench className="h-3.5 w-3.5" />}
            count={toolsQuery.data?.tools.length}
            isLoading={toolsQuery.isLoading}
            error={toolsQuery.error}
          >
            {toolsQuery.data && toolsQuery.data.tools.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">暂无可用工具</div>
            ) : (
              <ul className="space-y-0.5">
                {toolsQuery.data?.tools.map((tool) => (
                  <li
                    key={tool.name}
                    className="rounded-xl px-2 py-1.5 transition-colors hover:bg-foreground/[0.06]"
                  >
                    <div className="font-mono text-xs font-medium text-foreground">{tool.name}</div>
                    {tool.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {tool.description}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CatalogueButton>

          <CatalogueButton
            label="可用技能"
            tooltip="查看可用技能 (Skills)"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            count={skillsQuery.data?.skills.length}
            isLoading={skillsQuery.isLoading}
            error={skillsQuery.error}
          >
            {skillsQuery.data && skillsQuery.data.skills.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">暂无可用技能</div>
            ) : (
              <ul className="space-y-0.5">
                {skillsQuery.data?.skills.map((skill) => (
                  <li
                    key={skill.name}
                    className="rounded-xl px-2 py-1.5 transition-colors hover:bg-foreground/[0.06]"
                  >
                    <div className="text-xs font-medium text-foreground">{skill.name}</div>
                  </li>
                ))}
              </ul>
            )}
          </CatalogueButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeSessionId ? (
          <MessageList />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择一个会话开始聊天
          </div>
        )}
      </div>

      <div className="border-t border-white/50 p-3">
        <MessageInput disabled={!activeSessionId} />
      </div>
    </div>
  );
}
