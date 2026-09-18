/**
 * 客户端设置页：在设置窗口左侧加一项"复读打断"。
 *
 * 面板里编辑两样东西——拦截短句表（一行一句）与连续命中阈值，两者都写宿主侧
 * 注册的 settings 命名空间，保存后宿主侧立即按新配置判定。
 *
 * 本文件由 scripts/build-client.mjs 用 esbuild 单独打包成单文件 bundle
 * （`lib/client.js`），不走 tsc 的 lib 输出。
 */

import type { Context } from '@deepseek-ai/cordis';
// 空导入：只为加载这两处的 declaration merging（往 cordis 的 Context 上补
// slots 与 settingsScope 两个客户端服务）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { useEffect, useState, type ReactElement } from 'react';

/** settings 命名空间，必须与宿主侧 config.ts 的 SETTINGS_NS 逐字一致。 */
const SETTINGS_NS = 'repeat-guard';

/** 本插件配置节选。 */
interface RepeatGuardSettings {
  /** 拦截短句表。 */
  fragments?: string[];
  /** 连续命中多少行才拦。 */
  threshold?: number;
}

/** 注册设置页需要的服务；这两个是 cordis 服务名，不是包名。 */
export const inject = ['slots', 'settingsScope'];

/**
 * 客户端插件入口。
 * @param ctx - 浏览器侧 cordis 上下文。
 */
export function apply(ctx: Context): void {
  const scope = ctx.settingsScope.bind<RepeatGuardSettings>({ namespace: SETTINGS_NS });

  function Form({ initial }: { initial: RepeatGuardSettings }): ReactElement {
    const [fragments, setFragments] = useState(() => (initial.fragments ?? []).join('\n'));
    const [threshold, setThreshold] = useState(() => String(initial.threshold ?? 1));
    const [message, setMessage] = useState('');

    function save(): void {
      const list = fragments
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const count = Number(threshold);
      setMessage('保存中…');
      scope
        .set('fragments', list)
        .then(() => scope.set('threshold', count))
        .then(() => {
          setMessage('已保存');
        })
        .catch((error: unknown) => {
          setMessage(`保存失败：${String(error)}`);
        });
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label>
          <span>连续命中次数</span>
          <input
            type="number"
            value={threshold}
            onChange={(event) => {
              setThreshold(event.target.value);
            }}
          />
          <span>填 1 表示命中即拦；填 n 表示连着 n 行都命中才拦。</span>
        </label>
        <label>
          <span>拦截短句（一行一句，连标点一起写）</span>
          <textarea
            rows={16}
            style={{ width: '100%', fontFamily: 'monospace' }}
            value={fragments}
            onChange={(event) => {
              setFragments(event.target.value);
            }}
          />
        </label>
        <div>
          <button type="button" onClick={save}>
            保存
          </button>
          <span>{message}</span>
        </div>
      </div>
    );
  }

  function Panel(): ReactElement {
    const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
    useEffect(
      () =>
        scope.subscribe(() => {
          setSnapshot(scope.getSnapshot());
        }),
      [],
    );
    const value = snapshot.value;
    if (snapshot.status !== 'ready' || value === undefined) {
      return <p>{`配置尚未就绪（${snapshot.status}）`}</p>;
    }
    return <Form initial={value} />;
  }

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'repeat-guard', order: 100, label: '复读打断' },
      Panel,
    ),
  );
}
