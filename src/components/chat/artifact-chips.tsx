import { memo } from 'react';
import { File } from 'lucide-react';
import { openArtifact, type ArtifactInfo } from '@/lib/artifact';

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// turn 产物条：该 turn 最后一条 assistant 消息下方（历史块）或流式区末尾
// （实时）的 chip 行。点击进统一 openArtifact（点击时钉版，见 design D1）。
export const ArtifactChips = memo(function ArtifactChips({
  artifacts,
  msgTime,
}: {
  artifacts: ArtifactInfo[];
  msgTime?: string;
}) {
  if (artifacts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {artifacts.map((a) => (
        <button
          key={a.path}
          type="button"
          onClick={() => void openArtifact(a.path, { artifacts, msgTime })}
          className="glass-subtle flex h-7 items-center gap-1.5 rounded-full px-3 text-xs text-foreground/80 transition-all hover:bg-white/75 active:scale-[0.97]"
          title={a.version_id ? `历史版本 · ${a.path}` : `${a.path}（未快照，打开当前版本）`}
        >
          <File className="h-3 w-3 shrink-0" />
          <span className="max-w-48 truncate">{basename(a.path)}</span>
          <span className="text-muted-foreground">{formatSize(a.size)}</span>
        </button>
      ))}
    </div>
  );
});
