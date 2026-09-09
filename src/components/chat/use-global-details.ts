import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';

// 把原生 <details> 接入全局「展开全部/收起全部」覆盖信号：
// contentExpandAll 非 null 时直接控制 open 属性；collapseVersion 变化（每次点击
// 全局按钮）会清洗本地手动开合状态，让块重新跟随全局。null（未干预）时恢复
// 浏览器原生默认（思考默认折叠，由用户手动点开）。
export function useGlobalDetails(
  ref: React.RefObject<HTMLDetailsElement | null>,
): void {
  const expandAll = useUIStore((s) => s.contentExpandAll);
  const collapseVersion = useUIStore((s) => s.contentCollapseVersion);

  useEffect(() => {
    const el = ref.current;
    if (!el || expandAll === null) return;
    el.open = expandAll;
  }, [expandAll, collapseVersion, ref]);
}
