/**
 * `llm/stream` 监听器：包一层上游流，思考段命中复读退化就补完流并提前结束。
 *
 * 只检测 reasoning-delta（思考段）。正文 text-delta 不参与判定，原样透传。
 */
import type { GenerateOptions, GuardState, StreamChunk } from './types.js';
/** `llm/stream` 的监听器签名。 */
export type StreamListener = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>;
/**
 * 造一个 `llm/stream` 监听器。
 * @param state - 跨监听保留的拦截状态。
 * @returns 监听器；辅助调用直接透传，其余包一层复读检测。
 */
export declare function createStreamGuard(state: GuardState): StreamListener;
