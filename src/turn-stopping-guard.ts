/**
 * `agent/turn-stopping` 监听器：把上一步掐断欠下的续跑补上。
 *
 * 监听器的返回值不被使用（该事件是 serial 的副作用钩子），实现方式是调
 * `agent.steer(...)`，见 resume.ts 的说明。
 */

import type { Agent } from '@deepseek-ai/dsh-agent';
import { reviveTurn } from './resume.js';
import type { GuardState } from './types.js';

/**
 * 造一个 `agent/turn-stopping` 监听器。
 * @param state - 跨监听保留的拦截状态。
 * @returns 监听器；只在有待续跑标记时推一条输入。
 */
export function createTurnStoppingGuard(state: GuardState) {
  return (payload: { agent: Agent }): void => {
    reviveTurn(state, payload.agent);
  };
}
