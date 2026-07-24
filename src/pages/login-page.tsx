import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoggingIn, loginError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    try {
      await login({ username, password });
      navigate('/', { replace: true });
    } catch {
      // error is surfaced via loginError
    }
  };

  const errorMessage = loginError
    ? loginError instanceof ApiRequestError
      ? loginError.message
      : '登录失败，请重试'
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_10px_24px_-8px_rgba(255,159,10,0.7)]">
            <span className="text-lg font-semibold">b</span>
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">blowball</h1>
          <p className="text-sm text-muted-foreground">登录到您的工作区</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">用户名</label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              disabled={isLoggingIn}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">密码</label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              disabled={isLoggingIn}
            />
          </div>

          {errorMessage && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive backdrop-blur-md">
              {errorMessage}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={isLoggingIn}>
            {isLoggingIn ? '登录中...' : '登录'}
          </Button>
        </form>
      </div>
    </div>
  );
}
