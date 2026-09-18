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

/** dsh 跑在 Node 上；只声明本插件用到的全局，避免为此引入 @types/node。 */
declare const crypto: { randomUUID(): string };
declare const console: { log(...args: unknown[]): void };

/** 续跑时推给模型的指令正文。 */
const RESUME_TEXT = [
  '[复读拦截]',
  '你上一段思考退化成了碎片复读（反复输出"好。"一类的空话），已被系统截断。',
  '请直接继续执行下一步，不要再输出任何确认语、寒暄或空话。',
].join('\n');

/** 折叠行显示的一行摘要；空字符串会让客户端回退成 opaque 渲染，故不可为空。 */
const RESUME_SUMMARY = '复读已截断：请继续执行';

/**
 * 构造推给模型的一条输入，结构与 dsh 的 createUserMessage 对齐。
 * @returns 一条插件来源的 user 消息，客户端会渲染成折叠的 context 行。
 */
function resumeMessage(): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: RESUME_TEXT }],
    source: {
      kind: 'plugin',
      plugin: 'repeat-guard',
      form: 'notice',
      summary: RESUME_SUMMARY,
    },
  };
}

/**
 * 本轮即将关闭时，若上一步刚被掐断过，就推一条输入让本轮继续。
 * @param state - 跨监听保留的拦截状态。
 * @param agent - 本轮所属的 agent 句柄。
 */
export function reviveTurn(state: GuardState, agent: SteerableAgent | undefined): void {
  // 三个提前返回都要留痕：不打印就无法区分"没触发""id 对不上""没有标记"。
  if (agent === undefined || typeof agent.steer !== 'function') {
    console.log('[repeat-guard] turn-stopping：载荷里没有 agent 句柄，不续跑');
    return;
  }
  const sessionId = agent.session?.id;
  if (sessionId === undefined) {
    console.log('[repeat-guard] turn-stopping：agent 上没有会话 id，不续跑');
    return;
  }
  if (!state.pending.has(sessionId)) {
    console.log(
      `[repeat-guard] turn-stopping：会话 ${sessionId} 没有待续跑标记，不续跑` +
        `（当前有标记的会话：${[...state.pending].join(',') || '无'}）`,
    );
    return;
  }
  state.pending.delete(sessionId);
  console.log(`[repeat-guard] turn-stopping：会话 ${sessionId} 续跑一步`);
  agent.steer(resumeMessage());
}
