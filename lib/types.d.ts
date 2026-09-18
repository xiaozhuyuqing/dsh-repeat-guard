/**
 * 与本插件交互的 dsh 接口声明。
 *
 * 这些类型一律在本插件内声明，不 import dsh 的类型：那样还要为 tsc 配 paths 指向
 * dsh 安装目录，路径里带 node 版本号，dsh 一升级就失效。
 */
/** 一个流式 chunk。本插件只读 reasoning-delta 的 index/text，其余字段原样透传。 */
export interface StreamChunk {
    readonly type: string;
    readonly index?: number;
    readonly text?: string;
    readonly [key: string]: unknown;
}
/** 一次模型调用的参数；只声明本插件读到的两个字段。 */
export interface GenerateOptions {
    readonly purpose?: string;
    readonly sessionId?: string;
}
/**
 * `agent/turn-stopping` 的载荷。
 *
 * dsh 的注释写明：本轮即将关闭（模型不再欠响应）时、在边界提交之前 await 这个事件；
 * 监听器若不同意关闭，就调 `agent.steer(...)` 推入新的输入，机器会重读收件箱——
 * 有新的 steering 就再跑一步，没有才真正关闭本轮。
 */
export interface TurnStoppingPayload {
    readonly agent?: SteerableAgent;
}
/** 能往本轮收件箱推输入、从而让本轮继续的 agent 句柄。 */
export interface SteerableAgent {
    readonly session?: {
        readonly id?: string;
    };
    /** 推入 `next-step` 并唤醒驱动器：本轮再跑一步。 */
    steer(input: unknown): void;
}
/** 注入给 dsh 的 cordis 上下文；只声明本插件用到的能力。 */
export interface PluginContext {
    /**
     * 监听器的形参随所监听的事件而异，只能声明成 any[]：换成 unknown[] 会因函数
     * 参数逆变，导致各监听器的具体签名无法赋值。
     */
    on(name: string, listener: (...args: any[]) => unknown, options?: {
        global?: boolean;
    }): void;
}
/** 跨两次监听保留的拦截状态。 */
export interface GuardState {
    /** 发生过截断、等待下一步续跑的会话 id。 */
    readonly pending: Set<string>;
}
