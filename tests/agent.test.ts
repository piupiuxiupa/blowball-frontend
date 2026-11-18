import { test } from 'node:test';
import assert from 'node:assert/strict';

type IsConfuciusAgent = (agent: string) => boolean;

test('主 Agent 分类兼容历史 Confuse，且不误判真正的子 Agent', async () => {
  const module = (await import('@/lib/agent').catch(() => ({}))) as {
    isConfuciusAgent?: IsConfuciusAgent;
  };
  assert.equal(typeof module.isConfuciusAgent, 'function');
  const isConfucius = module.isConfuciusAgent!;

  assert.equal(isConfucius('Confucius'), true);
  assert.equal(isConfucius('Confuse'), true);
  assert.equal(isConfucius('Chongzhi'), false);
  assert.equal(isConfucius('Liang'), false);
  assert.equal(isConfucius('researcher#w-9f2d4c'), false);
});
