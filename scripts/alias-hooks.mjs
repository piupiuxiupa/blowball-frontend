const SRC = new URL('../src/', import.meta.url);

export async function resolve(specifier, context, next) {
  // 注意只匹配 '@/x'，不影响 '@scope/pkg' 形式的第三方作用域包。
  if (specifier.startsWith('@/')) {
    const target = new URL(specifier.slice(2), SRC).href;
    for (const suffix of ['.ts', '/index.ts', '']) {
      try {
        return await next(target + suffix, context);
      } catch {
        // 尝试下一个后缀
      }
    }
    throw new Error(`[alias-hooks] 无法解析 ${specifier}`);
  }
  return next(specifier, context);
}
