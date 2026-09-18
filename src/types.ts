/**
 * 本插件自有的类型。
 *
 * 与 dsh 交互的类型不在这里重抄：`Context`、`StreamChunk`、`GenerateOptions`、
 * `Agent`、`UserMessage` 一律从 `@deepseek-ai/*` 引。本地抄一份会在 dsh 升级时
 * 静默过期，而官方声明会让它在构建期就报出来。
 */

/** 跨两次监听保留的拦截状态。 */
export interface GuardState {
  /** 发生过截断、等待下一步续跑的会话 id。 */
  readonly pending: Set<string>;
}
