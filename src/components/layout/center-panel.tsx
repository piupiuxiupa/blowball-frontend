import { useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { FileRenderer } from '@/components/files/file-renderer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CenterPanel() {
  const activeFilePath = useUIStore((s) => s.activeFilePath);
  const queryClient = useQueryClient();
  // refreshKey 并入二进制查看器（图片/PDF 缓存破坏、Office 重挂载）；文本内容靠下方
  // query 失效重取（Monaco 监听 content 变化原地 setValue，无需重挂载）。
  const [refreshKey, setRefreshKey] = useState(0);
  const isRefreshing = useIsFetching({ queryKey: ['file-content', activeFilePath] }) > 0;

  const handleRefresh = () => {
    if (!activeFilePath) return;
    void queryClient.invalidateQueries({ queryKey: ['file-content', activeFilePath] });
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-white/50 bg-white/20 px-4 text-sm text-muted-foreground backdrop-blur-sm">
        <span className="truncate">{activeFilePath ? activeFilePath : '未选择文件'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleRefresh}
          disabled={!activeFilePath}
          title="刷新"
          aria-label="刷新文件内容"
        >
          <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <FileRenderer refreshKey={refreshKey} />
      </div>
    </div>
  );
}
