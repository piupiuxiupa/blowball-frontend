import { useRef } from 'react';
import { Wrench, Sparkles } from 'lucide-react';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';
import { useMcpTools, useSkills } from '@/hooks/use-catalogue';
import { useAttachRun } from '@/hooks/use-turn-lifecycle';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { CatalogueButton } from '@/components/chat/catalogue-button';
import { SelectionQuoteButton } from '@/components/chat/selection-quote-button';

export function ChatPanel() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  // 打开 generating 会话时自动 attach 运行中 turn（turn-detach-resume：reload 后的
  // run id 发现路径是会话列表项）。挂在聊天面板——它随活动会话驱动整个消息区。
  useAttachRun();
  // Tool/skill catalogues are global (not per-session), so they're available
  // to browse from the panel header even before a session is selected.
  const toolsQuery = useMcpTools();
  const skillsQuery = useSkills();

  return (
    <div className="flex h-full flex-col">
      {/* 头部自身是一个由 backdrop-blur 建立的层叠上下文，且在 DOM 中先于消息区。
          不提升 z-index 时，后绘制的消息层（glass 气泡各自的层叠上下文）会把
          工具/技能下拉浮层盖住。relative z-50 让头部及其下拉浮层整体压在消息层之上。 */}
      <div className="relative z-50 flex h-11 shrink-0 items-center justify-between border-b border-white/50 bg-white/20 px-4 text-sm font-medium backdrop-blur-sm">
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
                    <div className="flex items-baseline gap-2">
                      <div className="text-xs font-medium text-foreground">{skill.name}</div>
                      {skill.location === 'skill_market' && (
                        <div className="text-[10px] text-muted-foreground">技能市场</div>
                      )}
                    </div>
                    {skill.description && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {skill.description}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CatalogueButton>
        </div>
      </div>

      <div ref={messageAreaRef} className="flex-1 min-h-0 overflow-hidden">
        {/* 草稿态（lazy-session-creation）：未落库、永远没有消息——直接渲染空态文案，
            不挂 MessageList（历史查询本就按哨兵排除）；首条消息发出后活动会话已切到
            真实 id，自然过渡到列表渲染。 */}
        {activeSessionId === DRAFT_SESSION_ID ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            开始新的对话
          </div>
        ) : activeSessionId ? (
          <MessageList />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择一个会话开始聊天
          </div>
        )}
        {activeSessionId && <SelectionQuoteButton containerRef={messageAreaRef} />}
      </div>

      <div className="border-t border-white/50 p-3">
        <MessageInput disabled={!activeSessionId} />
      </div>
    </div>
  );
}
