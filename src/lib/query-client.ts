import { QueryClient } from '@tanstack/react-query';

// 应用级单例 QueryClient：main.tsx 用它挂 Provider，非组件代码（如文件编辑的
// 保存编排 file-edit-ops）也可直接 import 它来失效/读取缓存，无需 useQueryClient。
//
// refetchOnWindowFocus 默认关闭：编辑态下窗口聚焦不应触发内容重取抹掉本地改动
// （见 add-file-editing design 决策3）；需要「聚焦时探测远端变更」的地方改为显式
// 主动拉取并给出非阻塞提示（见 useFileEditActions 的 focus 监听）。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
