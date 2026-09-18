/**
 * 插件配置：拦截短句表与连续命中阈值。
 *
 * 配置放在 dsh 的 settings 服务里（命名空间 repeat-guard）：宿主侧在这边注册
 * schema，客户端设置页写同一个命名空间。判定时现取，改完立即生效，不用重启。
 */

import type { Context } from '@deepseek-ai/cordis';
// 空导入：只为加载它的 declaration merging（往 cordis 的 Context 上补 settings 服务）。
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';

/** settings 命名空间。客户端设置页必须写同一个值。 */
export const SETTINGS_NS = 'repeat-guard';

/** 默认的拦截短句表，标点照原样写。 */
export const DEFAULT_FRAGMENTS: readonly string[] = [
  '好。',
  '好的。',
  '好嘞。',
  '对。',
  '对的。',
  '是。',
  '是的。',
  '行。',
  '嗯。',
  '可以。',
  '明白。',
  '收到。',
  '了解。',
  '执行。',
  '继续。',
  '确认。',
  '完成。',
  '搞定。',
  '写。',
  '查。',
  '看。',
  'ok.',
  'okay.',
  'sure.',
  'alright.',
  'right.',
  'yes.',
  'done.',
  'got it.',
  'let me go.',
  'let me do it.',
  'check it.',
];

/** 默认阈值：1 表示发现即拦。 */
export const DEFAULT_THRESHOLD = 1;

const SCHEMA = z.object({
  fragments: z.array(z.string()).default([...DEFAULT_FRAGMENTS]),
  threshold: z.number().default(DEFAULT_THRESHOLD),
});

/** 一份生效中的配置，已编译成判定时直接可用的形式。 */
export interface RepeatGuardConfig {
  /** 短句表，已全部小写化。 */
  readonly fragments: ReadonlySet<string>;
  /** 连续命中多少行才拦。 */
  readonly threshold: number;
}

/** 取当前配置。 */
export type ConfigSource = () => RepeatGuardConfig;

function compile(value: { fragments: readonly string[]; threshold: number }): RepeatGuardConfig {
  return {
    fragments: new Set(value.fragments.map((fragment) => fragment.toLowerCase())),
    threshold: value.threshold,
  };
}

/**
 * 注册配置命名空间，并返回取当前配置的函数。
 * @param ctx - 宿主 cordis 上下文。
 * @returns 每次调用都返回最新配置。
 */
export function createConfigSource(ctx: Context): ConfigSource {
  let current = compile({ fragments: DEFAULT_FRAGMENTS, threshold: DEFAULT_THRESHOLD });
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(SETTINGS_NS, SCHEMA);
    const sync = (): void => {
      current = compile(scope.get());
    };
    sync();
    scope.watch(sync);
  });
  return () => current;
}
