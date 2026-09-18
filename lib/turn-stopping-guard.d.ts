/**
 * `agent/turn-stopping` 监听器：把上一步掐断欠下的续跑补上。
 *
 * 监听器的返回值不被使用（该事件是 serial 的副作用钩子），实现方式是调
 * `agent.steer(...)`，见 resume.ts 的说明。
 */
import type { GuardState } from './types.js';
/** `agent/turn-stopping` 的监听器签名。 */
export type TurnStoppingListener = (payload: unknown) => void;
/**
 * 造一个 `agent/turn-stopping` 监听器。
 * @param state - 跨监听保留的拦截状态。
 * @returns 监听器；只在有待续跑标记时推一条输入。
 */
export declare function createTurnStoppingGuard(state: GuardState): TurnStoppingListener;
