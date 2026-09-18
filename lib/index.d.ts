import type { PluginContext } from './types.js';
/**
 * 函数式插件入口。ctx 为 cordis 上下文，注册的监听随插件卸载自动释放。
 * @param ctx - 宿主 cordis 上下文。
 */
export default function repeatGuard(ctx: PluginContext): void;
