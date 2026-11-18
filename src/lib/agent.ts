// Confuse 是早期主编排 Agent 的持久化名，不能与动态子 Agent 一样收成触发行。
export function isConfuciusAgent(agent: string): boolean {
  return agent === 'Confucius' || agent === 'Confuse';
}
