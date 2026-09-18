# dsh-repeat-guard

拦截思考段的"复读"退化：模型在思考里陷入反复输出"好。""执行。"这类碎片空话时，掐断本次生成，并让本轮继续往下跑，而不是停下来等用户输入。

| 项 | 说明 |
|---|---|
| 类型 | dsh bundle，含宿主侧插件与客户端设置页 |
| 监听 | `llm/stream`、`agent/turn-stopping` |
| 入口 | `lib/index.js`（`src/index.ts`）、`lib/client.js`（`src/client.tsx`） |
| 可调项 | 拦截短句表、连续命中阈值、行内重复检测、续跑指令与折叠摘要（设置 → 复读打断） |
| 分发 | npm 包 `dsh-repeat-guard` |

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

表项**连标点一起写**（`'好的。'` 对应思考里的 `好的。`），英文条目一律写小写。分割单位是单个换行，空行会把连续计数打断。

### 行内重复检测（默认关）

上面那条规则只认"独占一行的整句"，所以 `好。好。好。` 这种挤在一行里的重复看不见——对 DeepSeek 够用，但有些模型是单行循环的，所以留了这个开关。

打开之后多一条判据：**整行由一个或多个表项首尾相接拼成**，也算命中（`好。好。好。`、`好。ok.好。`）。它仍然不会误杀——`我觉得可以。好。` 的前面那截不是表项、整行拼不出来，放行；`好的，好的` 也放行（表项是带句号的 `好的。`，这里是逗号）。

计数单位同时从"行"变成"表项"：整行全等算一次，行内每一段各算一次。所以阈值 2 配上它时，`好。好。` 这种一行两段的也会被拦。

**表可以在设置里改**（见下面「可调项」）；`src/config.ts` 的 `DEFAULT_FRAGMENTS` 是出厂默认值。

已知边界：判据只看"有没有这样一行"，不看上下文。所以"用户想让我改代码。\n好的。"这种**前面有实质内容、结尾又跟一句空话**的思考也会被拦。这是"按行判定"的直接结果。

## 连续命中阈值

阈值 `threshold` 是"连着几行命中才拦"：

| 值 | 行为 |
|---|---|
| 1（默认） | 任意一行命中即拦 |
| n | 连着 n 行都是表项（**句子可以各不相同**）才拦；中间夹一行不命中的就重新计数 |

阈值只在**同一次生成内**计数，不跨轮次。

## 命中在思考段末尾时不拦

命中之后，插件再往下探一格：

- 后面还是 `reasoning-delta` → 思考确实在继续复读，**拦**；
- 后面换成正文、工具调用，或直接收尾（`block-end` / `usage` / `finish` / 流结束）→ 说明命中行本来就是这段思考的最后一句，**不拦**，原样透传。

判据是**思考段是否还在往下写**，不是整个响应是否结束——思考以一句"好。"收尾、接着写正文，属正常收尾。

## 工作原理

1. 包一层 `llm/stream`（模型调用的流式 waterfall），逐 chunk 观察 `reasoning-delta`，累积本次响应已产出的思考文本。
2. 命中退化时，把触发退化的那个 delta 照常放行，补一个 `block-end` 闭合思考块，再补一个 `finish(stop)`，然后结束流。对 agent-loop 而言这就是一次正常完成：已生成的思考照常落盘，本轮该走什么流程就走什么流程。
3. 提前结束流时显式向下游传播 `iterator.return()`，否则上游 HTTP 流会继续跑到结束，供应商照常计满 token，且连接悬挂。
4. 光截断只会让本轮就此结束、停下来等用户输入。所以再挂一个 `agent/turn-stopping` 监听器，在本轮边界提交之前调 `agent.steer(...)` 推一条输入，本轮就会接着再跑一步。

辅助调用（上下文压缩、会话标题等带 `purpose` 的调用）不参与检测。

三种结局各有日志，便于事后核对误杀：

```
[repeat-guard] 检出思考段复读，已掐断本次生成 | 会话=… | 命中行="好的。"
[repeat-guard] 命中行位于思考段末尾，未拦截 | 会话=… | 命中行="好的。"
[repeat-guard] turn-stopping：会话 … 续跑一步
```

## 掐断之后怎么让本轮继续

dsh 的 turn 循环（`dsh-agent-loop/lib/index.js:966-973`）：

```js
if (turnEnds && this.inbox.nextStep.length === 0) {
  await this.dispatch.serial("agent/turn-stopping", { turn, signal });
}
if (turnEnds && this.inbox.nextStep.length === 0) break;   // 重读收件箱
```

`agent/turn-stopping` 在 `break` 之前被 `await`，之后收件箱会被**重新读一次**。所以只要监听器往 `inbox.nextStep` 里推入东西，本轮就不 break，而是再跑一步。官方对该事件的说明也写明了这个用法，先例见 `dsh-hooks-claude-code/lib/index.js:300`。

注意：

- **做不到"这一步当作没发生"。** 被截断的 assistant 消息在 `step()` 里已经 `session.append` 落盘，dsh 没有回滚一步的机制；`step()` 唯一返回 `null`（循环继续）的出口要求本步真的产生了 tool-call，插件够不着。所以这里的语义是"接着再跑一步"，会话里会留下被截断的思考记录。
- **续跑没有次数配额。** 有标记就推，同一轮里反复退化就反复续跑。

## 可调项

在 **设置 → 复读打断** 里改，保存后宿主侧立即按新配置判定，不用重启。

| 项 | 含义 |
|---|---|
| 累计拦截 | 自本次启动或上次清零以来掐断过多少次（只读，旁边有清零按钮） |
| 拦截短句 | 判为复读的空话短句表，一行一句，连标点一起写 |
| 连续命中次数 | 连着几次命中才拦；默认 1 = 发现即拦 |
| 行内重复检测 | 打开后"好。好。好。"这种挤在一行里的重复也算命中；默认关 |
| 续跑指令 | 截断后推给模型的指令正文，整段照发 |
| 折叠行摘要 | 那条注入消息在会话里的折叠行摘要 |

配置存在 dsh 的 settings 服务里（命名空间 `repeat-guard`），落盘在 `~/.dsh/settings.yaml` 的 `repeat-guard:` 节下。

**累计计数也寄在这个命名空间里**——宿主侧每掐断一次写一次，客户端读同一个值，清零就是把它写成 0。这样不用另开 host↔client 通道，代价是它跟着配置一起落盘；插件加载时会先把它归零，所以口径是"自本次启动或上次清零以来"。计数只在**真的掐断**时 +1，命中却落在思考段末尾（未拦截）的那种不计。

## 续跑时推给模型的输入

默认正文（可在设置里改）：

```
[复读拦截]
你上一段思考退化成了碎片复读（反复输出"好。"一类的空话），已被系统截断。
请直接继续执行下一步，不要再输出任何确认语、寒暄或空话。
```

这条消息带 `source.kind = 'plugin'`，客户端按 `source.summary`（同样可配置）渲染成折叠的 context 行，不是用户气泡。

## 构建

```bash
npm install
npm run build        # tsc 产出 lib/*.js，再用 esbuild 打 lib/client.js
```

两步各有各的产物：

- `tsc` 编译 `src/*.ts` → `lib/*.js`，宿主侧入口就是 `lib/index.js`（真正被 dsh import 的部分）。
- `scripts/build-client.mjs` 用 esbuild 把 `src/client.tsx` 打成**单文件** `lib/client.js`，外面套一层 dsh 客户端模块系统要求的包装：

  ```js
  window.__ModuleLoader__.load({ id: "dsh-repeat-guard", factory: function (require) { … } });
  ```

  `id` 必须是包名，`factory` 的返回值就是该包的客户端模块导出。`react` 等平台基座模块由模块系统提供，构建时设为 external，运行时从 `factory` 的 `require` 参数取。

`lib/` **不进版本库**：`npm publish` 前由 `prepack` 钩子现构建，随包发布（`files` 字段已含 `lib`）。这样"改了 `src/` 忘了 build"不会让旧产物静默跟着提交——代价是构建失败时发不出去，这是有意的。

## 发布

```bash
npm login   --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

**两条命令都别省 `--registry`。** npm 的凭据是**按源绑定**的：`npm login` 登的是哪个源，`~/.npmrc` 里就只在那个源下记一条 `//registry.npmjs.org/:_authToken`。所以 `npm config get registry` 一旦被切到 npmmirror 这类只读镜像（它本身也发不上去），不带参数的 `npm publish` 会直接报 `need auth`。

发布前不必手动构建，`prepack` 会跑一次 `npm run build`；tsc 或 esbuild 报错则发布中止。

## 安装到 dsh

```bash
dsh plugin --profile web add dsh-repeat-guard
```

本插件是一个 **dsh bundle**——包根带 `cordis.patch.yml`，由 `package.json` 的 `dsh.bundle.patch` 声明。装进 profile 时它会自动进入 `dsh.profile.bundles` 分层栈，**不需要改 profile 自己的 `cordis.patch.yml`**。客户端半靠 `package.json` 的 `dsh.client` 声明被自动发现，同样不用改 profile。

装完**必须重启 dsh 进程**。`patchReload: live` 只重载已有的层，不会加载新增的层——实测编辑后运行中的进程既不加载也不报错。

机制（dsh 源码）：`dsh plugin` 是 pnpm 转发器（`dsh/lib/plugin-*.js`），在 profile 目录跑 `pnpm add` 后按**安装后的真实包名**调和 `dsh.profile.bundles`，判定条件就是 `dsh.bundle.patch` 是否为 undefined（没有就印一句 "declares no dsh.bundle — installed as a plain dependency, not a profile layer"）。加载时 `dsh-app-boot` 的 `loadProfileDirectory` 对该字段做 `join(packageDir, declared)` 并当 overlay patch 读；声明缺失直接抛错。

**只走 npm 分发。** git 安装（`add github:...`）会让 pnpm 拦下依赖的构建脚本，装出来的包没有 `lib/index.js`，除非安装者手工去 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds` 白名单——那等于把本机的构建配置摊派给每个使用者。本地目录安装同理，只适合开发调试，不作为分发方式。

验证是否加载：

```bash
journalctl --user -u dsh-web --no-pager | grep -a repeat-guard
# [repeat-guard] 已加载，复读拦截生效
```

⚠️ 插件加载失败会让 **dsh 启动直接失败**，而 dsh-web 是本机 GUI 的唯一通道。改完先离线验证再重启：用假上下文 import 产物调一次入口，或喂一段真实 chunk 序列。

## 依赖

dsh 会把 bundle 声明的 `dependencies` 与 `peerDependencies` 从安装目录软链进 profile（`dsh-app-boot` 的 `healProfileModuleFallback`，依赖名取自 `profileDependencyNames(manifest)`，注释原文是 "dependency names that may be imported by a loader-visible plugin"）。软链落在 `~/.dsh/profiles/node_modules/`，Node 按常规向上查找即可解析到。

dsh 的 profile 同时带一份 `.npmrc`，写着 `auto-install-peers=false`（注释：core packages come from the CLI dependency tree; a profile must never resolve its own copy）——所以声明 `peerDependencies` 不会让 profile 自己再装一份宿主包。

所以：

- **宿主提供的包写 `peerDependencies`**：`@deepseek-ai/cordis`、`dsh-llm`、`dsh-agent`、`dsh-settings`、`schemastery`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`，以及客户端侧由平台基座提供的 `react`。它们不在 profile 里重复安装，用 dsh 自带的那份。
- **类型一律从官方引**，不在本地重抄。`Context`、`StreamChunk`、`GenerateOptions`、`Agent`、`SettingsScope` 都是 dsh 导出的；本地抄一份只会在 dsh 升级后于运行时暴露字段对不上，官方声明则会在 `tsc` 阶段直接报错。
- `src/types.ts` 只放本插件自有的类型（当前是 `GuardState`）。
- 部分 dsh 包的类型只通过 module augmentation 生效（如 `Context.settings`、`Context.slots`、`Context.settingsScope`），要显式 `import type {} from '…'` 触发加载，否则 `tsc` 会报"属性不存在"。
- dsh 的 loader 是原生 ESM import，**没有转译层**，运行时读到的永远是编译产物——改完 `src/` 必须重新构建。`lib/` 只随 npm 包发布，不进版本库。

## 代码约定

| 项 | 约定 |
|---|---|
| 缩进 / 引号 / 分号 | 2 空格、单引号、语句末分号 |
| 行宽 | 目标 100 字符，上限 120（中英混排按字符数计） |
| 控制语句 | **一律带花括号**，单行 `if`、`continue`、`break` 也不例外，不写 `if (x) return;` |
| 文件 | 一个文件只干一件事：类型声明 / 配置 / 判定 / 续跑 / 单个监听器 / 装配，各占一个文件 |
| 函数 | 不超过 50 行；超了就先看能不能按职责拆开 |
| 注释 | 一律中文；导出函数与判定函数配 `@param` / `@returns`，文件内小工具函数用单行注释即可 |

排版细节已固化在 `.editorconfig`。花括号、文件职责、函数行数这三条没有配置项可表达，只能靠人工遵守。

## 目录结构

```
.
├── src/
│   ├── index.ts                 宿主侧入口：装配状态，注册两个监听器（只做装配）
│   ├── types.ts                 本插件自有的类型（dsh 的接口一律从 @deepseek-ai/* 引）
│   ├── config.ts                配置：settings 命名空间、默认值、schema、取当前值
│   ├── detect.ts                复读判定：查表 + 连续计数，不碰会话状态
│   ├── resume.ts                续跑：注入文案、消息构造、推送
│   ├── stream-guard.ts          llm/stream 监听器：思考段检测与掐断
│   ├── turn-stopping-guard.ts   agent/turn-stopping 监听器：让本轮继续
│   └── client.tsx               客户端设置页：注册 settings.section
├── scripts/
│   └── build-client.mjs         esbuild 打包客户端半 → lib/client.js
├── lib/                         构建产物（已 gitignore），dsh 加载 lib/index.js 与 lib/client.js
├── cordis.patch.yml             bundle 层声明：把本插件挂进 profile 树
├── package.json
└── tsconfig.json
```

## 许可

MIT，见 `LICENSE`。
