import { useEffect, useId, useRef, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { loadOnlyOfficeApi, type OfficeEditorVersionResponse } from '@/lib/onlyoffice';
import { useOfficeVersionConfig } from '@/hooks/use-office-version-config';
import { useVersionBlob } from '@/hooks/use-file-versioning';
import { getFileExtension, isExcel, isWord } from '@/lib/file-type';
import { Skeleton } from '@/components/ui/skeleton';
import { WordViewer } from './word-viewer';
import { ExcelViewer } from './excel-viewer';

interface OfficeVersionViewerProps {
  path: string;
  versionId: string;
}

// How long to wait for the editor's onAppReady before assuming it stalled.
const LOAD_TIMEOUT_MS = 20000;

// 只读预览某个历史版本的 Office 文件（docx/xlsx/pptx 及 legacy doc/xls/ppt）。
//
// 三态机：
//   loading  → useOfficeVersionConfig 取签名配置中
//   success  → view-only OnlyOffice 挂载（始终 view，永不取 .edit / 不切 mode）
//   fallback → 503 ONLYOFFICE_DISABLED 或取配置失败 → 轻量查看器回退
//
// 版本不可变：无 nonce / 无刷新（后端按 versionId 派生稳定 document.key，DocumentServer
// 缓存转换结果）。回退分支的 useVersionBlob 仅在 OfficeFallbackViewer 挂载时发起——
// OO 成功时不拉取版本字节。
export function OfficeVersionViewer({ path, versionId }: OfficeVersionViewerProps) {
  const configQuery = useOfficeVersionConfig(path, versionId);

  if (configQuery.isLoading) {
    return <LoadingSkeleton />;
  }

  if (configQuery.data) {
    // key=versionId 强制版本切换时整体卸载/重挂：OnlyOffice 在同一 DOM 元素上
    // destroy 后重建会崩（白屏），必须每次拿全新挂载点（与 office-viewer.tsx 的
    // EditorMount key 同理）。注意 useOfficeVersionConfig 设了 staleTime: Infinity，
    // 看过的版本会命中缓存而跳过 loading 分支，没有这个 key 就会复用旧实例。
    return <ViewOnlyEditorMount key={versionId} data={configQuery.data} />;
  }

  // 503 ONLYOFFICE_DISABLED 或取配置失败：回退轻量查看器（blob 仅在此挂载时拉取）。
  return <OfficeFallbackViewer path={path} versionId={versionId} />;
}

// view-only OnlyOffice 编辑器挂载。复用 office-viewer.tsx 的 EditorMount 生命周期模式
// （loadOnlyOfficeApi → new DocEditor → onAppReady/onError + 超时 + 卸载 destroyEditor），
// 但无 mode/nonce：版本永远 view，配置取 data.view（永不取 .edit）。
function ViewOnlyEditorMount({ data }: { data: OfficeEditorVersionResponse }) {
  // useId() can contain ':' which breaks some internal lookups; sanitize.
  const editorId = 'oov-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const editorRef = useRef<OnlyOfficeEditorInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string>('');

  useEffect(() => {
    // 版本永远 view：只取 .view 的签名配置 + token，永不取 .edit。
    const { config, token } = data.view;
    let cancelled = false;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    setReady(false);
    setEditorError(null);

    const fail = (msg: string) => {
      if (cancelled || settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      setEditorError(msg);
    };

    (async () => {
      try {
        await loadOnlyOfficeApi(data.server_url);
      } catch (e) {
        fail(`加载 OnlyOffice 脚本失败：${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (cancelled) return;

      setDocUrl(config.document.url);

      const mount = document.getElementById(editorId);
      const DocsAPI = window.DocsAPI;
      if (cancelled || !mount) {
        fail('编辑器挂载点未就绪');
        return;
      }
      if (!DocsAPI) {
        fail('OnlyOffice 脚本已加载，但 window.DocsAPI 不可用');
        return;
      }
      try {
        editorRef.current = new DocsAPI.DocEditor(editorId, {
          ...config,
          token,
          width: '100%',
          height: '100%',
          events: {
            onAppReady: () => {
              if (cancelled || settled) return;
              settled = true;
              if (timeoutId) clearTimeout(timeoutId);
              setReady(true);
            },
            onError: (event: unknown) => {
              fail(`编辑器事件错误：${JSON.stringify(event) ?? String(event)}`);
            },
          },
        });
      } catch (e) {
        fail(`编辑器初始化抛错：${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      timeoutId = setTimeout(() => {
        fail(`OnlyOffice ${LOAD_TIMEOUT_MS / 1000}s 内未就绪。`);
      }, LOAD_TIMEOUT_MS);
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        editorRef.current?.destroyEditor();
      } catch {
        // editor may already be gone
      }
      editorRef.current = null;
    };
  }, [data, editorId]);

  const loading = !editorError && !ready;

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {editorError ? (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <pre className="whitespace-pre-wrap break-words text-center text-xs text-destructive">
            {editorError}
            {docUrl ? `\n\n文档地址（DocumentServer 拉取）：\n${docUrl}` : ''}
          </pre>
        </div>
      ) : (
        <div id={editorId} className="h-full w-full" />
      )}
    </div>
  );
}

// 回退分支：OnlyOffice 未配置（503）或取配置失败时，用轻量查看器渲染版本字节。
// 仅在此组件挂载时才经 useVersionBlob 拉取版本字节（OO 成功时本组件不挂载，不拉字节）。
// .docx→WordViewer、.xlsx→ExcelViewer；.pptx/.ppt 及其它无轻量解析的 Office 类型→占位提示。
function OfficeFallbackViewer({ path, versionId }: OfficeVersionViewerProps) {
  const ext = getFileExtension(path);
  const { data: blob, isLoading, error } = useVersionBlob(path, versionId);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (error) return <NoLightweightPlaceholder path={path} />;
  if (isLoading || !objectUrl) return <LoadingSkeleton />;

  if (isWord(ext)) return <WordViewer path={path} url={objectUrl} />;
  if (isExcel(ext)) return <ExcelViewer path={path} url={objectUrl} />;

  // pptx / ppt / 其它无轻量解析：占位提示。
  return <NoLightweightPlaceholder path={path} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function NoLightweightPlaceholder({ path }: { path: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <FileWarning className="h-10 w-10" />
      <p className="text-sm">该版本类型暂不支持在线预览</p>
      <p className="text-xs">{path}</p>
    </div>
  );
}
