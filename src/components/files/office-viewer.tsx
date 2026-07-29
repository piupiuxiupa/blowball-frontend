import { useEffect, useId, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { loadOnlyOfficeApi } from '@/lib/onlyoffice';
import { useOfficeConfig } from '@/hooks/use-office-config';
import { useUIStore } from '@/stores/ui-store';

interface OfficeViewerProps {
  path: string;
  /** 由统一工具条「刷新」按钮 bump：并入 EditorMount 的 key 与配置查询的 nonce，
   * 触发重新挂载并重取配置，让 OnlyOffice 用全新 document.key 重新转换。 */
  refreshKey?: number;
}

// How long to wait for the editor's onAppReady before assuming it stalled.
const LOAD_TIMEOUT_MS = 20000;

// Renders an office file (docx/xlsx/pptx, and legacy doc/xls/ppt) via a local or
// remote OnlyOffice DocumentServer in EDIT or VIEW mode, persisting saves back
// to the workspace through the backend's save-callback endpoint (saves only fire
// in edit mode).
//
// 只读/编辑模式读取统一的 ui-store.fileViewMode（task 2.2：移除组件自身的切换按钮，
// 交由中间面板工具条统一控制）。OfficeEditorModeName 与 fileViewMode 取值同名
// （'edit' | 'view'），直接复用。
//
// All OnlyOffice config (secret, server_url, internal_backend) is owned by the
// backend — this component fetches one signed response carrying BOTH an edit and
// a view config (each with its own token), then hands the chosen mode's
// {...config, token} to DocsAPI.DocEditor. OnlyOffice signs the whole config, so
// switching modes uses the pre-signed token for that mode rather than mutating a
// config in place. Refresh re-fetches so the backend mints a new random
// document.key, forcing OnlyOffice to re-convert (never a stale cached document).
//
// Switching files, modes, or pressing Refresh remounts <EditorMount> (keyed by
// path+mode+refreshKey) so OnlyOffice never reuses a stale element/session across
// documents — reusing it crashes the editor (blank screen). Each document gets
// its own fresh mount + lifecycle.
export function OfficeViewer({ path, refreshKey = 0 }: OfficeViewerProps) {
  const mode = useUIStore((s) => s.fileViewMode);
  return (
    <EditorMount
      key={`${path}::${mode}::${refreshKey}`}
      path={path}
      nonce={refreshKey}
      mode={mode}
    />
  );
}

// Which of the two backend-signed configs to instantiate.
type OfficeEditorModeName = 'edit' | 'view';

interface EditorMountProps {
  path: string;
  nonce: number;
  mode: OfficeEditorModeName;
}

// One OnlyOffice editor instance, fully isolated. Mounted fresh per document
// (via the parent's key) and destroyed on unmount.
function EditorMount({ path, nonce, mode }: EditorMountProps) {
  // useId() can contain ':' which breaks some internal lookups; sanitize.
  const editorId = 'oo-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const editorRef = useRef<OnlyOfficeEditorInstance | null>(null);

  const { data, error: queryError } = useOfficeConfig(path, nonce);
  const [ready, setReady] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string>('');

  useEffect(() => {
    // Wait for the signed config before doing anything; the loading skeleton is
    // shown while data is absent.
    if (!data) return;
    // Pick the pre-signed config + token for the requested mode. Both modes ship
    // in one response, so switching is a remount with the other token — no extra
    // round-trip, and no in-place config mutation (which would break the
    // signature).
    const { config, token } = data[mode];
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
  }, [data, mode, editorId]);

  const errorMsg = queryError
    ? `获取编辑配置失败：${queryError instanceof Error ? queryError.message : String(queryError)}`
    : editorError;
  const loading = !errorMsg && !ready;

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {errorMsg ? (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <pre className="whitespace-pre-wrap break-words text-center text-xs text-destructive">
            {errorMsg}
            {docUrl ? `\n\n文档地址（DocumentServer 拉取）：\n${docUrl}` : ''}
          </pre>
        </div>
      ) : (
        <div id={editorId} className="h-full w-full" />
      )}
    </div>
  );
}
