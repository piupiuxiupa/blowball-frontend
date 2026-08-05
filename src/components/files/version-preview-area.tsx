import { useState } from 'react';
import { RotateCcw, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRestoreVersion } from '@/hooks/use-file-versioning';
import { VersionPreview } from './version-preview';

interface VersionPreviewAreaProps {
  path: string;
  versionId: string;
  /** 恢复成功后：由 center-panel bump refreshKey（Office 重挂载）并退出预览。 */
  onRestored: () => void;
  /** 退出预览：返回正常编辑/查看。 */
  onExit: () => void;
}

// 主编辑区的版本只读预览容器：头部承载「恢复此版本」「退出预览」，内容区为只读
// VersionPreview。恢复 = 把该版本字节写回工作区工作文件（不新建 office-vers 版本）。
export function VersionPreviewArea({ path, versionId, onRestored, onExit }: VersionPreviewAreaProps) {
  const restore = useRestoreVersion();
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const outcome = await restore(path, versionId);
      if (outcome === 'success') onRestored();
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-amber-300/40 bg-amber-50/70 px-4 text-sm text-amber-800 backdrop-blur-sm">
        <span>只读预览历史版本</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-amber-800 hover:bg-amber-200/50"
            onClick={() => void handleRestore()}
            disabled={restoring}
            title="把此版本内容写回当前工作文件"
          >
            {restoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            恢复此版本
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-amber-800 hover:bg-amber-200/50"
            onClick={onExit}
            title="退出预览"
          >
            <X className="h-3.5 w-3.5" />
            退出预览
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <VersionPreview path={path} versionId={versionId} />
      </div>
    </div>
  );
}
