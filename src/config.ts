/**
 * 插件配置：拦截短句表、连续命中阈值、行内重复检测、续跑注入的正文与摘要，
 * 外加一个运行时计数。
 *
 * dsh 0.1.7 起，配置就是插件自己的 entry Config——标记 `.volatile()` 的字段由宿主
 * 的设置表单读写，写回的是 profile 的 cordis patch。宿主侧不再注册命名空间，
 * 而是持有这些稳定引用，需要时 `.get()` 现取，所以改完立即生效，不用重启。
 *
 * 计数也寄在同一份配置里：宿主侧每次掐断写一次，客户端读同一个值、清零就是把它
 * 写成 0。插件加载时先把它归零，所以口径是"自本次启动或上次清零以来"。
 */

import type { Context } from '@deepseek-ai/cordis';
// 空导入：只为加载它的 declaration merging（往 cordis 的 Context 上补 settings 服务）。
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';

/**
 * profile 里本插件的条目 id。设置表单按它定位配置，宿主写回也要用它，
 * 所以必须与 cordis.patch.yml 里的 `id` 逐字一致。
 */
export const ENTRY_ID = 'dsh-repeat-guard';

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

/** 默认关闭行内重复检测：只认独占一行的整句。 */
export const DEFAULT_INLINE_REPEAT = false;

/** 默认的续跑指令正文，截断后推给模型。 */
export const DEFAULT_RESUME_TEXT = [
  '[复读拦截]',
  '你上一段思考退化成了碎片复读（反复输出"好。"一类的空话），已被系统截断。',
  '请直接继续执行下一步，不要再输出任何确认语、寒暄或空话。',
].join('\n');

/** 默认的折叠行摘要；客户端拿它渲染折叠的 context 行，不是用户气泡。 */
export const DEFAULT_RESUME_SUMMARY = '复读已截断：请继续执行';

/**
 * 插件 Config schema。只有标了 `.volatile()` 的字段会进设置表单并支持编辑，
 * 其余字段仍是普通配置（只由 cordis 配置文件决定）。
 */
export const Config = z.object({
  fragments: z.array(z.string()).default([...DEFAULT_FRAGMENTS]).volatile(),
  threshold: z.number().default(DEFAULT_THRESHOLD).volatile(),
  inlineRepeat: z.boolean().default(DEFAULT_INLINE_REPEAT).volatile(),
  resumeText: z.string().default(DEFAULT_RESUME_TEXT).volatile(),
  resumeSummary: z.string().default(DEFAULT_RESUME_SUMMARY).volatile(),
  count: z.number().default(0).volatile(),
});

/** loader 解析后交给插件的配置：volatile 字段是稳定引用，取值要 `.get()`。 */
export type RepeatGuardConfigSchema = Schemastery.TypeT<typeof Config>;

/** 判定与续跑用得上的一份配置。 */
export interface RepeatGuardConfig {
  /** 短句表，已全部小写化。 */
  readonly fragments: ReadonlySet<string>;
  /** 连续命中多少次才拦。 */
  readonly threshold: number;
  /** 是否把"整行由多个表项拼成"也算命中。 */
  readonly inlineRepeat: boolean;
  /** 截断后推给模型的指令正文。 */
  readonly resumeText: string;
  /** 注入消息的折叠行摘要。 */
  readonly resumeSummary: string;
}

/** 取当前配置。 */
export type ConfigSource = () => RepeatGuardConfig;

/** 宿主侧要用到的两件事：取配置、记一次拦截。 */
export interface GuardRuntime {
  /** 取当前配置。 */
  readonly read: ConfigSource;
  /** 记一次拦截，把计数写回配置。 */
  readonly countHit: () => void;
}

function compile(value: {
  fragments: readonly string[];
  threshold: number;
  inlineRepeat: boolean;
  resumeText: string;
  resumeSummary: string;
}): RepeatGuardConfig {
  return {
    fragments: new Set(value.fragments.map((fragment) => fragment.toLowerCase())),
    threshold: value.threshold,
    inlineRepeat: value.inlineRepeat,
    resumeText: value.resumeText,
    resumeSummary: value.resumeSummary,
  };
}

/**
 * 把 volatile 引用折叠成一份快照，返回宿主侧要用的运行时句柄。
 * @param ctx - 宿主 cordis 上下文。
 * @param config - loader 解析后的本插件配置。
 * @returns 取配置与记数两个入口。
 */
export function createRuntime(ctx: Context, config: RepeatGuardConfigSchema): GuardRuntime {
  const read = (): RepeatGuardConfig =>
    compile({
      fragments: config.fragments.get(),
      threshold: config.threshold.get(),
      inlineRepeat: config.inlineRepeat.get(),
      resumeText: config.resumeText.get(),
      resumeSummary: config.resumeSummary.get(),
    });

  let write: ((count: number) => void) | undefined;
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings;
    // 本插件自带设置页，关掉宿主按 schema 自动生成的页面。
    settingsCtx.effect(() => settings.configure({ auto: false }, ctx.fiber));
    write = (count: number): void => {
      // 现取 revision：表单刚写过的话，旧 revision 会被 SETTINGS_CONFLICT 拒掉。
      const revision = settings.describe().find((entry) => entry.ns === ENTRY_ID)?.revision;
      settings.update(ENTRY_ID, { count }, revision).catch((error: unknown) => {
        console.log(`[repeat-guard] 写设置失败：${String(error)}`);
      });
    };
    // 计数口径是"自本次启动或上次清零以来"。
    write(0);
  });

  return {
    read,
    countHit: () => {
      write?.(config.count.get() + 1);
    },
  };
}
