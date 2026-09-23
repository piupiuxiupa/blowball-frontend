// turn-artifacts：后端 turn 产物版本库的客户端。版本库与 office-vers 同空间
// （后端 design D5 修订），产物预览因此与工作区版本预览共用同一套面板
// （selectFileVersion → 现有 VersionPreviewArea），这里只保留事件解析与钉版。
// - artifact 事件 content = ArtifactInfo JSON 串（事件行持久化，done 不持久化）
import { apiGet, type ArtifactInfo } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

export type { ArtifactInfo };

// 解析 artifact 事件行的 content；坏行返回 null（调用方跳过，不影响分组）。
export function parseArtifactInfo(content: string): ArtifactInfo | null {
  try {
    const v = JSON.parse(content) as ArtifactInfo;
    return typeof v?.path === 'string' ? v : null;
  } catch {
    return null;
  }
}

// 点击时钉版的兜底解析（design D1）：(path, before) 答案不可变，会话级缓存。
// 404（从未快照）与一切失败归一为 null = 打开当前版本，不阻断点击。
export function resolveArtifactVersion(path: string, before: string): Promise<string | null> {
  return queryClient.fetchQuery({
    queryKey: ['artifact-resolve', path, before],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const info = await apiGet<ArtifactInfo>('/api/v1/workspace/versions/resolve', {
          params: { path, before },
        });
        return info.version_id ?? null;
      } catch {
        return null;
      }
    },
  });
}

// ── 打开动作（design D1/D5）──────────────────────────────────────────────────
// 点击时钉版：本 turn 产物列表 → resolve 兜底 → 当前版本。versionId 为空走
// selectFile（保留 dirty 拦截/工具条），有值走只读版本预览。
import { selectFile, selectFileVersion } from '@/hooks/use-file-edit';
import { getFileExtension, isOffice } from '@/lib/file-type';
import { useUIStore } from '@/stores/ui-store';

export interface ArtifactPinContext {
  artifacts?: ArtifactInfo[];
  msgTime?: string;
}

export async function openArtifact(path: string, ctx?: ArtifactPinContext | null): Promise<void> {
  const hit = ctx?.artifacts?.find((a) => a.path === path);
  // 本 turn 产物但未快照（无 version_id）：按 spec 打开当前版本，不再 resolve。
  const vid = hit
    ? hit.version_id
    : ctx?.msgTime
      ? await resolveArtifactVersion(path, ctx.msgTime)
      : null;
  if (vid) {
    // 与工作区同一套面板：selectFileVersion = selectFile + 钉版（含 dirty 拦截）。
    selectFileVersion(path, vid);
  } else {
    openCurrent(path);
  }
}

// 打开当前版本：Office 一律 view 预览（产物链接语义是「看交付物」；工具条仍可手切编辑）。
function openCurrent(path: string): void {
  if (isOffice(getFileExtension(path))) {
    useUIStore.getState().setFileViewMode('view');
  }
  selectFile(path);
}

// blowball://workspace/<path> → 工作区相对路径（URL decode）。
export function parseArtifactHref(href: string): string | null {
  const PREFIX = 'blowball://workspace/';
  if (!href.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(PREFIX.length));
  } catch {
    return null;
  }
}
