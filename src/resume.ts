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
 * 用户输入。dsh 自己的 dsh-hooks-claude-code/lib/index.js:300 就是这么用的。
 *
 * 推什么内容由配置决定（见 config.ts 的 resumeText / resumeSummary）。
 */

import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { RepeatGuardConfig } from './config.js';
import type { GuardState } from './types.js';

/**
 * 本轮即将关闭时，若上一步刚被掐断过，就推一条输入让本轮继续。
 * @param state - 跨监听保留的拦截状态。
 * @param agent - 本轮所属的 agent 句柄。
 * @param config - 当前配置，正文与摘要都从这里取。
 */
export function reviveTurn(state: GuardState, agent: Agent, config: RepeatGuardConfig): void {
  const sessionId = agent.session.id;
  if (!state.pending.has(sessionId)) {
    return;
  }
  state.pending.delete(sessionId);
  console.log(`[repeat-guard] turn-stopping：会话 ${sessionId} 续跑一步`);
  agent.steer(
    createUserMessage({
      content: [{ type: 'text', text: config.resumeText }],
      // `form: 'notice'` 要求同时给出 `summary`（dsh-llm 的 ContextFormed），
      // 客户端据此把它渲染成折叠的 context 行，而不是用户气泡。
      source: {
        kind: 'plugin',
        plugin: 'repeat-guard',
        form: 'notice',
        summary: config.resumeSummary,
      },
    }),
  );
}
