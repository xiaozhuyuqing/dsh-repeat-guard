/**
 * 续跑：截断之后让本轮不要就此关闭，而是再跑一步。
 *
 * 机制在 dsh 侧：`agent/turn-stopping` 是 serial 事件，在本轮边界提交之前被 await，
 * 之后收件箱会被重新读一次（dsh-agent-loop/lib/index.js:967-973）：
 *
 *     if (turnEnds && this.inbox.nextStep.length === 0) {
 *       await this.dispatch.serial("agent/turn-stopping", { turn, signal });
 *     }
 *     if (turnEnds && this.inbox.nextStep.length === 0) break;   // 重读，读到东西就不 break
 *
 * 所以在监听器里调 `agent.steer(...)` 推入一条输入，本轮就会再跑一步，而不是停下来等
 * 用户输入。dsh 自己在 dsh-hooks-claude-code/lib/index.js:292 有同样的用法。
 */
import type { GuardState, SteerableAgent } from './types.js';
/**
 * 本轮即将关闭时，若上一步刚被掐断过，就推一条输入让本轮继续。
 * @param state - 跨监听保留的拦截状态。
 * @param agent - 本轮所属的 agent 句柄。
 */
export declare function reviveTurn(state: GuardState, agent: SteerableAgent | undefined): void;
