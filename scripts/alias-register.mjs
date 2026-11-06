import { register } from 'node:module';

// 回归入口（adapt-session-message-queue 6.1）：Node 直跑 TS 无打包器，这里补上
// Vite 提供的两个隐式行为——@/ 路径别名（tsconfig paths）与无扩展名导入补 .ts。
register(new URL('./alias-hooks.mjs', import.meta.url));
