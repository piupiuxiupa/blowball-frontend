import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLLMToken } from '@/hooks/use-llm-token';
import { ApiRequestError } from '@/lib/api';

const MAX_TOKEN_LENGTH = 512;
const DIALOG_TITLE_ID = 'llm-token-dialog-title';

interface LLMTokenDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LLMTokenDialog({ open, onClose }: LLMTokenDialogProps) {
  const {
    status,
    isStatusLoading,
    statusError,
    saveToken,
    isSaving,
    saveError,
    resetSaveError,
    deleteToken,
    isDeleting,
    deleteError,
    resetDeleteError,
  } = useLLMToken({ enabled: open });
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // 每次打开都从一个空输入和干净的错误/成功提示开始；已保存 Token 只展示掩码。
  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setNotice(null);
    resetSaveError();
    resetDeleteError();
  }, [open, resetSaveError, resetDeleteError]);

  if (!open) return null;

  const isBusy = isSaving || isDeleting;
  const requestError =
    saveError ?? deleteError ?? (statusError instanceof Error ? statusError : null);
  const errorMessage = requestError
    ? requestError instanceof ApiRequestError
      ? requestError.message
      : '操作失败，请重试'
    : null;

  const changeApiKey = (value: string) => {
    setApiKey(value);
    setNotice(null);
    resetSaveError();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    setNotice(null);
    try {
      const saved = await saveToken({ api_key: trimmed });
      setApiKey('');
      setNotice(`已保存 ${saved.masked_key ?? '***'}`);
    } catch {
      // mutation.error 已在弹窗中展示；这里吞掉 rejection 避免 unhandled rejection。
    }
  };

  const remove = async () => {
    setNotice(null);
    try {
      await deleteToken();
      setApiKey('');
      setNotice('已删除，后续调用回退到系统全局密钥');
    } catch {
      // mutation.error 已在弹窗中展示；这里吞掉 rejection 避免 unhandled rejection。
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={DIALOG_TITLE_ID}
        className="w-full max-w-md rounded-2xl border border-white/60 bg-background p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={DIALOG_TITLE_ID} className="text-sm font-semibold text-foreground">
              模型网关 Token
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              为当前账号配置个人 LLM 网关 Token。保存后你的模型调用会优先使用它；
              明文只在保存请求中传输，之后不再回显。
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/60 bg-white/45 p-3 text-xs">
          <div className="text-muted-foreground">当前状态</div>
          {isStatusLoading ? (
            <Skeleton className="mt-2 h-4 w-32" />
          ) : status ? (
            <div className="mt-1 font-medium text-foreground">
              {status.configured ? (
                <>
                  已配置
                  {status.masked_key && (
                    <span className="ml-2 rounded-full bg-foreground/10 px-2 py-0.5 font-mono text-[11px] text-foreground/75">
                      {status.masked_key}
                    </span>
                  )}
                </>
              ) : (
                '未配置，使用系统全局密钥'
              )}
            </div>
          ) : (
            <div className="mt-1 text-destructive">状态加载失败</div>
          )}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-2">
            <label htmlFor="llm-api-key" className="text-xs font-medium text-foreground">
              新 Token
            </label>
            <Input
              id="llm-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => changeApiKey(event.target.value)}
              placeholder="sk-..."
              maxLength={MAX_TOKEN_LENGTH}
              autoComplete="new-password"
              spellCheck={false}
              disabled={isBusy}
            />
          </div>

          {notice && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5 text-xs text-foreground">
              {notice}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={isBusy || !status?.configured}
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              删除
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isBusy}>
                关闭
              </Button>
              <Button type="submit" size="sm" disabled={isBusy || !apiKey.trim()}>
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
