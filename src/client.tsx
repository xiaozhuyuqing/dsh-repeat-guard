/**
 * 客户端设置页：在设置窗口左侧加一项"复读打断"。
 *
 * 版式照着官方设置页来：顶部一行"左标题 + 右保存"，下面每项是一行
 * （左标题与描述、右控件），样式全部用 dsh 的设计令牌 `--dsw-*`，
 * 由本模块自己注入 `<style>`，与官方 feature（如 theme 的字号行）同款做法。
 *
 * 本文件由 scripts/build-client.mjs 用 esbuild 单独打包成单文件 bundle
 * （`lib/client.js`），不走 tsc 的 lib 输出。
 */

import type { Context } from '@deepseek-ai/cordis';
// 空导入：只为加载这两处的 declaration merging（往 cordis 的 Context 上补
// slots 与 settingsScope 两个客户端服务）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';

/** settings 命名空间，必须与宿主侧 config.ts 的 SETTINGS_NS 逐字一致。 */
const SETTINGS_NS = 'repeat-guard';

/** 阈值步进器的取值边界。 */
const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 9;

/** 宿主侧注册的配置。字段都带 schema 默认值，所以在这里是必有的。 */
interface RepeatGuardSettings {
  /** 拦截短句表。 */
  fragments: string[];
  /** 连续命中多少次才拦。 */
  threshold: number;
  /** 是否把"整行由多个表项拼成"也算命中。 */
  inlineRepeat: boolean;
  /** 截断后推给模型的指令正文。 */
  resumeText: string;
  /** 注入消息的折叠行摘要。 */
  resumeSummary: string;
  /** 累计拦截次数，由宿主侧维护。 */
  count: number;
}

/** 输入框与文本域的公共外观。 */
const FIELD = `height:36px;box-sizing:border-box;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px`;

/** 样式。令牌名取自 dsh 前端已发布的设计令牌表。 */
const CSS = `
.rg-root{display:flex;flex-direction:column;width:100%}
.rg-head{display:flex;align-items:center;gap:12px;padding:2px 0 14px}
.rg-headTitle{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.rg-headNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.rg-save{cursor:pointer;flex:none;height:32px;padding:0 16px;border:none;border-radius:16px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-family:inherit;font-size:14px;line-height:22px}
.rg-save:hover{background:var(--dsw-alias-button-primary-hover)}
.rg-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.rg-row--stack{flex-direction:column;align-items:stretch;gap:10px}
.rg-rowText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}
.rg-rowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.rg-rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.rg-control{display:inline-flex;align-items:center;gap:8px}
.rg-stepper{position:relative;display:inline-flex;justify-content:center;align-items:center;min-width:72px;height:36px;border-radius:18px;background:var(--dsw-alias-bg-module-platform)}
.rg-stepperValue{min-width:18px;text-align:center;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.rg-stepperUnit{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.rg-arrows{position:absolute;right:8px;display:flex;flex-direction:column;gap:2px;opacity:0}
.rg-stepper:hover .rg-arrows,.rg-stepper:focus-within .rg-arrows{opacity:1}
.rg-arrow{display:inline-flex;justify-content:center;align-items:center;width:17px;height:12px;padding:0;border:none;border-radius:3px;cursor:pointer;color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent)}
.rg-arrow:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.rg-arrow:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.rg-switch{position:relative;flex:none;width:40px;height:24px;padding:0;border:none;border-radius:12px;cursor:pointer;background:var(--dsw-alias-bg-module-platform);transition:background .15s ease}
.rg-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .15s ease}
.rg-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.rg-switch[aria-checked="true"]::after{transform:translateX(16px)}
.rg-count{display:inline-flex;align-items:center;justify-content:center;min-width:72px;height:36px;padding:0 14px;box-sizing:border-box;border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}
.rg-list{display:flex;flex-direction:column;gap:2px;width:100%;max-height:300px;overflow-y:auto;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-module-platform);box-sizing:border-box}
.rg-item{display:flex;align-items:center;gap:8px;padding:5px 6px 5px 12px;border-radius:8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.rg-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.rg-itemText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rg-remove{flex:none;display:inline-flex;justify-content:center;align-items:center;width:24px;height:24px;padding:0;border:none;border-radius:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-tertiary)}
.rg-remove:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.rg-empty{padding:10px 12px;color:var(--dsw-alias-label-caption);font-size:13px;line-height:20px}
.rg-addRow{display:flex;align-items:center;gap:8px;width:100%}
.rg-input{flex:1;min-width:0;${FIELD}}
.rg-summaryInput{flex:none;width:260px;${FIELD}}
.rg-textarea{width:100%;min-height:84px;box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;resize:vertical}
.rg-input:focus,.rg-summaryInput:focus,.rg-textarea:focus{outline:none;border-color:var(--dsw-alias-border-l4)}
.rg-button{cursor:pointer;flex:none;height:32px;padding:0 14px;border:none;border-radius:16px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px}
.rg-button:hover{background:var(--dsw-alias-interactive-bg-active)}
`;

const STYLE_TAG = 'dsh-repeat-guard/panel.css';

/** 注入一次本插件的样式；重复挂载不重复插。 */
function injectStyle(): void {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`) !== null) {
    return;
  }
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-repeat-guard';
  tag.dataset.pluginCss = STYLE_TAG;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  onChange: (next: number) => void;
}

/** 数字步进器：数值居中，悬停或聚焦时右侧浮出上下箭头。 */
function Stepper({ value, min, max, unit, label, onChange }: StepperProps): ReactElement {
  return (
    <span className="rg-control">
      <span className="rg-stepper">
        <span className="rg-stepperValue">{value}</span>
        <span className="rg-arrows">
          <button
            type="button"
            className="rg-arrow"
            aria-label={`增大${label}`}
            disabled={value >= max}
            onClick={() => {
              onChange(value + 1);
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <path
                d="M1.4 6.2 4.5 3.1l3.1 3.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="rg-arrow"
            aria-label={`减小${label}`}
            disabled={value <= min}
            onClick={() => {
              onChange(value - 1);
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <path
                d="M1.4 2.8 4.5 5.9l3.1-3.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </span>
      <span className="rg-stepperUnit">{unit}</span>
    </span>
  );
}

interface SwitchProps {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}

/** 开关。 */
function Switch({ checked, label, onChange }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="rg-switch"
      onClick={() => {
        onChange(!checked);
      }}
    />
  );
}

interface FragmentListProps {
  items: readonly string[];
  draft: string;
  onDraft: (next: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/** 短句表：可滚动的列表，逐条删除，底部一行新增。 */
function FragmentList({ items, draft, onDraft, onAdd, onRemove }: FragmentListProps): ReactElement {
  function handleKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      onAdd();
    }
  }

  return (
    <>
      <div className="rg-list">
        {items.length === 0 ? <div className="rg-empty">表是空的，不会拦截任何短句。</div> : null}
        {items.map((item, index) => (
          <div className="rg-item" key={`${item}#${String(index)}`}>
            <span className="rg-itemText">{item}</span>
            <button
              type="button"
              className="rg-remove"
              aria-label={`删除 ${item}`}
              onClick={() => {
                onRemove(index);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="rg-addRow">
        <input
          className="rg-input"
          value={draft}
          placeholder="新增短句，连标点一起写，回车添加"
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onKeyDown={handleKey}
        />
        <button type="button" className="rg-button" onClick={onAdd}>
          添加
        </button>
      </div>
    </>
  );
}

interface FormProps {
  initial: RepeatGuardSettings;
  /** 宿主侧实时计数；由外层订阅刷新，不参与本地编辑。 */
  count: number;
  onReset: () => Promise<void>;
  onSave: (next: RepeatGuardSettings) => Promise<void>;
}

/** 设置表单：标题行 + 五行设置；改动先留在本地，点保存才写。 */
function Form({ initial, count, onReset, onSave }: FormProps): ReactElement {
  const [items, setItems] = useState<readonly string[]>(initial.fragments);
  const [limit, setLimit] = useState(initial.threshold);
  const [inlineRepeat, setInlineRepeat] = useState(initial.inlineRepeat);
  const [resumeText, setResumeText] = useState(initial.resumeText);
  const [resumeSummary, setResumeSummary] = useState(initial.resumeSummary);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  function add(): void {
    const value = draft.trim();
    if (value === '') {
      return;
    }
    setItems([...items, value]);
    setDraft('');
    setNote('');
  }

  function remove(index: number): void {
    setItems(items.filter((_, at) => at !== index));
    setNote('');
  }

  function save(): void {
    setNote('保存中…');
    onSave({
      fragments: [...items],
      threshold: limit,
      inlineRepeat,
      resumeText,
      resumeSummary,
      count,
    })
      .then(() => {
        setNote('已保存');
      })
      .catch((error: unknown) => {
        setNote(`保存失败：${String(error)}`);
      });
  }

  function reset(): void {
    onReset()
      .then(() => {
        setNote('计数已清零');
      })
      .catch((error: unknown) => {
        setNote(`清零失败：${String(error)}`);
      });
  }

  return (
    <div className="rg-root">
      <div className="rg-head">
        <span className="rg-headTitle">复读打断</span>
        <span className="rg-headNote">{note}</span>
        <button type="button" className="rg-save" onClick={save}>
          保存
        </button>
      </div>
      <div className="rg-row">
        <div className="rg-rowText">
          <div className="rg-rowTitle">累计拦截</div>
          <div className="rg-rowDesc">重复打断计数</div>
        </div>
        <span className="rg-control">
          <span className="rg-count">{count} 次</span>
          <button type="button" className="rg-button" onClick={reset}>
            清零
          </button>
        </span>
      </div>
      <div className="rg-row">
        <div className="rg-rowText">
          <div className="rg-rowTitle">连续命中次数</div>
          <div className="rg-rowDesc">循环次数上限；填 1 表示发现即拦</div>
        </div>
        <Stepper
          value={limit}
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          unit="次"
          label="连续命中次数"
          onChange={(next) => {
            setLimit(next);
            setNote('');
          }}
        />
      </div>
      <div className="rg-row">
        <div className="rg-rowText">
          <div className="rg-rowTitle">行内重复检测</div>
          <div className="rg-rowDesc">
            拦截类似"好。好。好。"的行内循环；关闭时只检测独立段落。
          </div>
        </div>
        <Switch
          checked={inlineRepeat}
          label="行内重复检测"
          onChange={(next) => {
            setInlineRepeat(next);
            setNote('');
          }}
        />
      </div>
      <div className="rg-row rg-row--stack">
        <div className="rg-rowText">
          <div className="rg-rowTitle">拦截短句</div>
          <div className="rg-rowDesc">标点不可省略</div>
        </div>
        <FragmentList
          items={items}
          draft={draft}
          onDraft={setDraft}
          onAdd={add}
          onRemove={remove}
        />
      </div>
      <div className="rg-row rg-row--stack">
        <div className="rg-rowText">
          <div className="rg-rowTitle">拦截提示词</div>
          <div className="rg-rowDesc">截断后上下文注入的提示词</div>
        </div>
        <textarea
          className="rg-textarea"
          value={resumeText}
          onChange={(event) => {
            setResumeText(event.target.value);
            setNote('');
          }}
        />
      </div>
      <div className="rg-row">
        <div className="rg-rowText">
          <div className="rg-rowTitle">拦截摘要</div>
          <div className="rg-rowDesc">上下文注入的简介信息，仅用户可见</div>
        </div>
        <input
          className="rg-summaryInput"
          value={resumeSummary}
          onChange={(event) => {
            setResumeSummary(event.target.value);
            setNote('');
          }}
        />
      </div>
    </div>
  );
}

/** 注册设置页需要的服务；这两个是 cordis 服务名，不是包名。 */
export const inject = ['slots', 'settingsScope'];

/**
 * 客户端插件入口。
 * @param ctx - 浏览器侧 cordis 上下文。
 */
export function apply(ctx: Context): void {
  injectStyle();
  const scope = ctx.settingsScope.bind<RepeatGuardSettings>({ namespace: SETTINGS_NS });

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
      return <div className="rg-empty">{`配置尚未就绪（${snapshot.status}）`}</div>;
    }
    return (
      <Form
        initial={value}
        count={value.count}
        onReset={async () => {
          await scope.set('count', 0);
        }}
        onSave={async (next) => {
          await scope.set('fragments', next.fragments);
          await scope.set('threshold', next.threshold);
          await scope.set('inlineRepeat', next.inlineRepeat);
          await scope.set('resumeText', next.resumeText);
          await scope.set('resumeSummary', next.resumeSummary);
        }}
      />
    );
  }

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'repeat-guard', order: 100, label: '复读打断' },
      Panel,
    ),
  );
}
