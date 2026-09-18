/**
 * `llm/stream` 监听器：包一层上游流，思考段命中复读退化就补完流并提前结束。
 *
 * 只检测 reasoning-delta（思考段）。正文 text-delta 不参与判定，原样透传。
 */

import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ConfigSource } from './config.js';
import { findDegenerateLine } from './detect.js';
import type { GuardState } from './types.js';

/** `llm/stream` 的监听器签名。 */
type StreamListener = (
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
) => AsyncIterable<StreamChunk>;

/**
 * 逐 chunk 检查上游流的思考段，命中复读退化时补完这段流。
 *
 * 适配器只开一个 reasoning 块（dsh-llm-deepseek: `reasoningBlock` 是单个变量），
 * 所以累积文本用一个字符串即可，不需要按 index 分开存。
 *
 * 命中之后先往下探一格，判"思考段是不是就到这儿了"：再往下若还是 reasoning-delta，
 * 说明思考在继续复读，该拦；若换成正文、工具调用，或直接收尾，说明命中行本来就是
 * 这段思考的最后一句，属正常收尾，不拦。
 *
 * @param downstream - 上游模型的流。
 * @param sessionId - 当前会话 id；有值才登记待续跑标记。
 * @param state - 跨监听保留的拦截状态。
 * @param readConfig - 取当前配置；每个 chunk 现取，改设置立即生效。
 * @returns 包好的流。
 */
async function* guardStream(
  downstream: AsyncIterable<StreamChunk>,
  sessionId: GenerateOptions['sessionId'],
  state: GuardState,
  readConfig: ConfigSource,
): AsyncGenerator<StreamChunk> {
  const iterator = downstream[Symbol.asyncIterator]();
  let accumulated = '';
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done) {
        return;
      }
      const chunk = step.value;
      if (chunk.type === 'reasoning-delta') {
        accumulated += chunk.text;
        const config = readConfig();
        const hit = findDegenerateLine(accumulated, config.fragments, config.threshold);
        if (hit !== null) {
          const probe = await iterator.next();
          if (!probe.done && probe.value.type === 'reasoning-delta') {
            if (sessionId !== undefined) {
              state.pending.add(sessionId);
            }
            console.log(
              `[repeat-guard] 检出思考段复读，已掐断本次生成 | 会话=${sessionId ?? '无'} | 命中行=${JSON.stringify(hit)}`,
            );
            // 触发点本身已经产生了，照常放行；要掐掉的是它之后的思考。
            yield chunk;
            yield { type: 'block-end', index: chunk.index, block: { type: 'reasoning', text: accumulated } };
            yield { type: 'finish', reason: { kind: 'stop' } };
            return;
          }
          console.log(
            `[repeat-guard] 命中行位于思考段末尾，未拦截 | 会话=${sessionId ?? '无'} | 命中行=${JSON.stringify(hit)}`,
          );
          yield chunk;
          if (!probe.done) {
            yield probe.value;
          }
          continue;
        }
      }
      yield chunk;
    }
  } finally {
    // 提前 return 时必须显式向下游传播：不补这一步上游 HTTP 流会继续跑到结束，
    // 供应商照常计满 token，且连接悬挂。上游可能已经结束/关闭，其异常忽略。
    try {
      await iterator.return?.();
    } catch {
      /* 上游已经结束或关闭，无需处理 */
    }
  }
}

/**
 * 造一个 `llm/stream` 监听器。
 * @param state - 跨监听保留的拦截状态。
 * @param readConfig - 取当前配置。
 * @returns 监听器；辅助调用直接透传，其余包一层复读检测。
 */
export function createStreamGuard(state: GuardState, readConfig: ConfigSource): StreamListener {
  return (options, next) => {
    // 辅助调用（上下文压缩、会话标题）不参与检测。
    if (options.purpose !== undefined) {
      return next();
    }
    return guardStream(next(), options.sessionId, state, readConfig);
  };
}
