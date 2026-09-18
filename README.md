# dsh-repeat-guard

拦截思考段的"复读"退化：模型在思考里陷入反复输出"好。""执行。"这类碎片空话时，掐断本次生成，并让本轮继续往下跑，而不是停下来等用户输入。

| 项 | 说明 |
|---|---|
| 类型 | dsh host 侧插件（函数式） |
| 监听 | `llm/stream`、`agent/turn-stopping` |
| 运行时依赖 | **无**，不产生任何运行时 import |
| 构建期依赖 | 仅 TypeScript |
| 入口 | `lib/index.js`（由 `src/index.ts` 编译得到） |

---

## 它解决什么问题

模型退化时，思考段里会出现整行都是空话的情况，如"好。""执行。""OK." "Let me go."。

这类思考本身不含信息，但会一直持续到 token 耗尽，把一次本可以正常完成的任务拖垮。

## 检测范围

**只看思考段（`reasoning-delta`），正文（`text-delta`）不参与判定，原样透传。**

复读退化先出现在思考段，那时正文往往还没开始产出；等正文也碎掉再掐，思考段已经白烧了一遍。

## 判据：查表

判定不做任何"形状归纳"，只查一张表：**思考里有没有独占一行的表项**。

最初试过两条归纳式判据，都被证伪：

1. **数碎片重复了几次**（"好，好，好，好"）。它不看句子结构，只看重复次数，于是"然后，然后，然后，"（逗号被当作片段分隔符）这类正常句子会被判成复读。
2. **按形状判断空话行**（中文去标点后 ≤2 字、英文 ≤3 词）。形状规则必然外溢："解。""豫。"这种被换行切开的半截词也满足形状，实测在大段正常思考里频繁误杀。

表项是具体的、可增删的、可审计的，不会外溢。规则只有一条：

```
整行去掉首尾空白 → 转小写 → 查表
```

| 输入 | 结果 |
|---|---|
| `好。` `好的。` `执行。` `写。` `明白。` | 拦（表内） |
| `OK.` `Sure.` `Let me go.` `Got it.` | 拦（表内） |
| `查一下。` `这需要我。` | 不拦（表外） |
| `A.` `1.` | 不拦（表外） |
| `然后，` `注意：` `好的，` | 不拦（表外） |
| `好？` `好！` `好` `OK` | 不拦（表外） |
| `我需要检查实现。\n然后重新编译。` | 不拦（各行都在表外） |

**表在 `src/detect.ts` 的 `FRAGMENTS` 数组里**，增删词条改它即可。表项**连标点一起写**（`'好的。'` 对应思考里的 `好的。`），英文条目一律写小写。

已知边界：判据只看"有没有这样一行"，不看上下文。所以"用户想让我改代码。\n好的。"这种**前面有实质内容、结尾又跟一句空话**的思考也会被拦。这是"按行判定"的直接结果。

## 工作原理

1. 包一层 `llm/stream`（模型调用的流式 waterfall），逐 chunk 观察 `reasoning-delta`，累积本次响应已产出的思考文本。
2. 命中退化时，把触发退化的那个 delta 照常放行，补一个 `block-end` 闭合思考块，再补一个 `finish(stop)`，然后结束流。agent-loop 的 `BlockAssembler` 会把这种"没有 finish 就结束"的流当作正常 `stop`，于是本次调用被当成正常完成：已生成的思考照常落盘。
3. 提前结束流时显式向下游传播 `iterator.return()`，否则上游 HTTP 流会继续跑到结束，供应商照常计满 token，且连接悬挂。
4. 光截断只会让本轮就此结束、停下来等用户输入。所以再挂一个 `agent/turn-stopping` 监听器，在本轮边界提交之前调 `agent.steer(...)` 推一条输入，本轮就会接着再跑一步。

辅助调用（上下文压缩、会话标题等带 `purpose` 的调用）不参与检测。

每次拦截都会把**命中的那一行原文**写进 journal，便于事后核对误杀：

```
[repeat-guard] 检出思考段复读，已掐断本次生成 | 命中行="好的。"
```

## 掐断之后怎么让本轮继续

dsh 的 turn 循环（`dsh-agent-loop/lib/index.js:966-973`）：

```js
if (turnEnds && this.inbox.nextStep.length === 0) {
  await this.dispatch.serial("agent/turn-stopping", { turn, signal });
}
if (turnEnds && this.inbox.nextStep.length === 0) break;   // 重读收件箱
```

`agent/turn-stopping` 在 `break` 之前被 `await`，之后收件箱会被**重新读一次**。所以只要监听器往 `inbox.nextStep` 里推入东西，本轮就不 break，而是再跑一步。官方对该事件的说明也写明了这个用法，先例见 `dsh-hooks-claude-code/lib/index.js:292`。

注意：

- **做不到"这一步当作没发生"。** 被截断的 assistant 消息在 `step()` 里已经 `session.append` 落盘，dsh 没有回滚一步的机制；`step()` 唯一返回 `null`（循环继续）的出口要求本步真的产生了 tool-call，插件够不着。所以这里的语义是"接着再跑一步"，会话里会留下被截断的思考记录。

## 可调项

判定本身没有阈值，只有 `src/detect.ts` 里的 `FRAGMENTS` 表。改完需要重新构建。

| 项 | 位置 | 含义 |
|---|---|---|
| `FRAGMENTS` | `src/detect.ts` | 会被判为复读的空话短句表，增删词条改它 |

## 续跑时推给模型的输入

```
[复读拦截]
你上一段思考退化成了碎片复读（反复输出"好。"一类的空话），已被系统截断。
请直接继续执行下一步，不要再输出任何确认语、寒暄或空话。
```

这条消息带 `source.kind = 'plugin'`，客户端会渲染成折叠的 context 行，不是用户气泡。

## 构建

```bash
npm install
npm run build        # 等价于 tsc，产出 lib/
```

## 安装到 dsh

本插件是一个 **dsh bundle**——包根带 `cordis.patch.yml`，由 `package.json` 的 `dsh.bundle.patch` 声明。装进 profile 时它会自动进入 `dsh.profile.bundles` 分层栈，**不需要改 profile 自己的 `cordis.patch.yml`**。

```bash
dsh plugin --profile web add dsh-repeat-guard                 # npm 包
dsh plugin --profile web add github:<owner>/dsh-repeat-guard  # git 仓库
dsh plugin --profile web add /abs/path/to/dsh-repeat-guard    # 本地目录（开发用）
```

装完**必须重启 dsh 进程**。`patchReload: live` 只重载已有的层，不会加载新增的层——实测编辑后运行中的进程既不加载也不报错。

机制（dsh 源码）：`dsh plugin` 是 pnpm 转发器（`dsh/lib/plugin-*.js`），在 profile 目录跑 `pnpm add` 后按**安装后的真实包名**调和 `dsh.profile.bundles`，判定条件就是 `dsh.bundle.patch` 是否为 undefined（没有就印一句 "declares no dsh.bundle — installed as a plain dependency, not a profile layer"）。加载时 `dsh-app-boot` 的 `loadProfileDirectory` 对该字段做 `join(packageDir, declared)` 并当 overlay patch 读；声明缺失直接抛错。

本地开发用 `link:` 安装（`dsh plugin --profile web add <绝对路径>` 即得），之后改源码只需 `npm run build` + 重启，不必重装。

验证是否加载：

```bash
journalctl --user -u dsh-web --no-pager | grep -a repeat-guard
# [repeat-guard] 已加载，复读拦截生效
```

⚠️ 插件加载失败会让 **dsh 启动直接失败**，而 dsh-web 是本机 GUI 的唯一通道。改完先离线验证再重启：用假上下文 import 产物调一次入口，或喂一段真实 chunk 序列。

## 开发约束：不得 import 外部包

**不得 import 任何外部包，包括 `@deepseek-ai/cordis`；模块之间只用相对路径互相导入。**

`cordis-plugin-loader` 的 `import()` 对**裸 specifier**（包名）直接 `import(name)`，锚点是 loader 自身的文件位置（dsh 安装目录内部），从 profile 或全局顶层加载时都可能解析不到插件的依赖。而**相对 specifier** 走 `new URL(name, baseUrl)`，由 Node 原生 ESM 按当前文件位置解析，不受影响——所以内部拆模块是安全的，新增模块时只连相对路径即可，源码里要带 `.js` 后缀。

由这条约束派生的两点：

- 类型一律在 `src/types.ts` 里声明，不 import dsh 的类型（那还要为 `tsc` 配 `paths` 指向 dsh 安装目录，路径里带 node 版本号，dsh 一升级就失效），也不引 `@types/node`（各模块按需 `declare` 用到的全局）；
- 只用 TypeScript 写源码，由 `tsc` 产出 `lib/` 供 dsh 加载。dsh 的 loader 是原生 ESM import，**没有转译层**，运行时读到的永远是编译产物——改完 `src/` 必须重新构建，否则改动不会生效。

## 代码约定

| 项 | 约定 |
|---|---|
| 缩进 / 引号 / 分号 | 2 空格、单引号、语句末分号 |
| 行宽 | 目标 100 字符，上限 120（中英混排按字符数计） |
| 控制语句 | **一律带花括号**，单行 `if`、`continue`、`break` 也不例外，不写 `if (x) return;` |
| 文件 | 一个文件只干一件事：类型声明 / 判定 / 续跑 / 单个监听器 / 装配，各占一个文件 |
| 函数 | 不超过 50 行；超了就先看能不能按职责拆开 |
| 注释 | 一律中文；导出函数与判定函数配 `@param` / `@returns`，文件内小工具函数用单行注释即可 |

排版细节已固化在 `.editorconfig`。花括号、文件职责、函数行数这三条没有配置项可表达，只能靠人工遵守。

## 目录结构

```
.
├── src/
│   ├── index.ts                 插件入口：装配状态，注册两个监听器（只做装配）
│   ├── types.ts                 与 dsh 交互的接口声明（纯类型，编译后为空模块）
│   ├── detect.ts                复读判定：阈值常量 + 纯函数，不碰会话状态
│   ├── resume.ts                续跑：注入文案、消息构造、推送
│   ├── stream-guard.ts          llm/stream 监听器：思考段检测与掐断
│   └── turn-stopping-guard.ts   agent/turn-stopping 监听器：让本轮继续
├── lib/                         tsc 产物，dsh 实际加载 lib/index.js
├── package.json
└── tsconfig.json
```


## 许可

MIT，见 `LICENSE`。
