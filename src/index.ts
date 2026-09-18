// dsh-repeat-guard — host 侧插件入口：拦截"复读"型退化输出。
//
// 做法：包一层 `llm/stream`（模型调用的流式 waterfall），逐 chunk 观察思考段
// （reasoning-delta）。命中退化时，把触发退化的那个 delta 照常放行，补一个 block-end
// 闭合思考块，再补一个 finish(stop)，然后直接结束流。对 agent-loop 而言这就是一次正常
// 完成：已生成的思考照常落盘，本轮该走什么流程就走什么流程。
//
// 只检测思考段：正文 text-delta 不参与判定。复读退化先出现在思考段，那时正文往往还没
// 开始产出；等正文也碎掉再掐，思考段已经白烧了一遍。
//
// 判定做什么：思考段里出现独占一行的表项（如"好。""执行。""Let me go."）就掐断，
// 表在 detect.ts 的 FRAGMENTS 里。不做形状归纳——归纳出的规则总会外溢误伤，表项则是
// 具体、可增删、可审计的。
//
// 掐断之后要让本轮继续，而不是停下来等用户输入：挂在 `agent/turn-stopping` 上，在本轮
// 边界提交之前调 `agent.steer(...)` 推一条输入，机器就会再跑一步。详见 resume.ts。
//
// 依赖：dsh 把 bundle 的 dependencies / peerDependencies 从安装目录软链进 profile
// （dsh-app-boot 的 healProfileModuleFallback），所以本插件可以正常 import
// `@deepseek-ai/*`——它们声明在 peerDependencies 里，由宿主提供。
//
// 本文件只做装配，具体逻辑在各自的模块里。

import type { Context } from '@deepseek-ai/cordis';
import { createStreamGuard } from './stream-guard.js';
import { createTurnStoppingGuard } from './turn-stopping-guard.js';
import type { GuardState } from './types.js';

/**
 * 函数式插件入口。ctx 为 cordis 上下文，注册的监听随插件卸载自动释放。
 * @param ctx - 宿主 cordis 上下文。
 */
export default function repeatGuard(ctx: Context): void {
  // 直接写 stdout：dsh 把插件的 stdout 收进 journal，便于确认插件确实被加载。
  console.log('[repeat-guard] 已加载，复读拦截生效');
  const state: GuardState = { pending: new Set() };
  ctx.on('llm/stream', createStreamGuard(state), { global: true });
  ctx.on('agent/turn-stopping', createTurnStoppingGuard(state));
}
