import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  // 登录用户稳定 id。作为 office-vers 版本命名空间的 {uuid}（见 add-file-versioning）。
  userId: string | null;
  expire: number | null;
  isAuthenticated: boolean;
  hydrated: boolean;
  login: (token: string, expire: number, userId: string) => void;
  logout: () => void;
  finishHydration: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      userId: null,
      expire: null,
      isAuthenticated: false,
      hydrated: false,
      login: (token, expire, userId) =>
        set({ token, userId, expire, isAuthenticated: true }),
      logout: () =>
        set({ token: null, userId: null, expire: null, isAuthenticated: false }),
      finishHydration: () => {
        const state = get();
        if (!state) return;
        const expired = state.expire ? Date.now() / 1000 > state.expire : false;
        if (state.token && !expired) {
          set({ isAuthenticated: true, hydrated: true });
        } else {
          set({ token: null, userId: null, expire: null, isAuthenticated: false, hydrated: true });
        }
      },
    }),
    {
      name: 'blowball-auth',
      partialize: (state) => ({ token: state.token, userId: state.userId, expire: state.expire }),
    }
  )
);
