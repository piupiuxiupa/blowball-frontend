import { useAuth } from '@/hooks/use-auth';
import { useResizableWidth } from '@/hooks/use-resizable-width';
import { Button } from '@/components/ui/button';
import { Resizer } from '@/components/ui/resizer';
import { Sidebar } from './sidebar';
import { CenterPanel } from './center-panel';
import { ChatPanel } from './chat-panel';

const LEFT_PANEL_KEY = 'blowball:left-panel-width';
const RIGHT_PANEL_KEY = 'blowball:right-panel-width';

export function AppLayout() {
  const { logout } = useAuth();
  const [leftWidth, adjustLeftWidth] = useResizableWidth(LEFT_PANEL_KEY, 288, { min: 200, max: 480 });
  const [rightWidth, adjustRightWidth] = useResizableWidth(RIGHT_PANEL_KEY, 420, { min: 320, max: 720 });

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      {/* Floating glass header bar */}
      <header className="glass flex h-12 shrink-0 items-center justify-between rounded-2xl px-4">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_rgba(255,159,10,0.7)]">
            <span className="text-xs">b</span>
          </span>
          blowball
        </div>
        <Button variant="ghost" size="sm" onClick={logout}>
          退出登录
        </Button>
      </header>

      {/* Three glass panels with resizer-gutters between them */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="glass flex shrink-0 flex-col overflow-hidden rounded-2xl"
          style={{ width: leftWidth }}
        >
          <Sidebar />
        </aside>

        <Resizer onResize={adjustLeftWidth} />

        <main className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
          <CenterPanel />
        </main>

        <Resizer onResize={(delta) => adjustRightWidth(-delta)} />

        <aside
          className="glass flex shrink-0 flex-col overflow-hidden rounded-2xl"
          style={{ width: rightWidth }}
        >
          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}
