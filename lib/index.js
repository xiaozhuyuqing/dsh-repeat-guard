// dsh-repeat-guard — host 侧插件入口：拦截"复读"型退化输出。
//
// 做法：包一层 `llm/stream`（模型调用的流式 waterfall），逐 chunk 观察思考段
// （reasoning-delta）。命中退化时，把触发退化的那个 delta 照常放行，补一个 block-end
// 闭合思考块，再补一个 finish(stop)，然后直接结束流。agent-loop 的 BlockAssembler 会把
// 这种"没有 finish 就结束"的流当作正常 stop（assembler.js: `this._finish ?? {kind:'stop'}`），
// 于是本次调用被当成正常完成：已生成的思考照常落盘，本轮该走什么流程就走什么流程。
//
// 只检测思考段：正文 text-delta 不参与判定。复读退化先出现在思考段，那时正文往往还没
// 开始产出；等正文也碎掉再掐，思考段已经白烧了一遍。
//
// 判定做什么：思考段里出现单独成行的一句空话（中文一到两个汉字，如"好。""执行。"；
// 英文不超过三个单词，如"OK." "Let me go."）就掐断。判据的取舍见 detect.ts 的注释——
// 关键是不能把"同样的碎片出现了几次"当作复读信号，那样会误伤正常的短句。
//
// 掐断之后要让本轮继续，而不是停下来等用户输入：挂在 `agent/turn-stopping` 上，在本轮
// 边界提交之前调 `agent.steer(...)` 推一条输入，机器就会再跑一步。详见 resume.ts。
//
// 依赖约束（重要）：不得 import 任何外部包，包括 @deepseek-ai/cordis。
// cordis-plugin-loader 解析裸 specifier 时直接 `import(name)`，锚点是 loader 自身的
// 文件位置（dsh 安装目录内部），从 profile 或全局顶层加载时都可能解析不到插件的依赖。
// **相对路径 import 不受此限**：它由 Node 原生 ESM 按当前文件位置解析，所以本插件内部
// 按职责拆出的这些模块可以正常互相导入。新增模块时照此办理：只连相对路径。
//
// 本文件只做装配，具体逻辑在各自的模块里。
import { createStreamGuard } from './stream-guard.js';
import { createTurnStoppingGuard } from './turn-stopping-guard.js';
/**
 * 函数式插件入口。ctx 为 cordis 上下文，注册的监听随插件卸载自动释放。
 * @param ctx - 宿主 cordis 上下文。
 */
export default function repeatGuard(ctx) {
    // 直接写 stdout：dsh 把插件的 stdout 收进 journal，便于确认插件确实被加载。
    console.log('[repeat-guard] 已加载，复读拦截生效');
    const state = { pending: new Set() };
    ctx.on('llm/stream', createStreamGuard(state), { global: true });
    ctx.on('agent/turn-stopping', createTurnStoppingGuard(state));
}
