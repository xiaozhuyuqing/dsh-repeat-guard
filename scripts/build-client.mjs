/**
 * 把客户端半打包成 dsh 客户端模块系统要求的单文件 bundle。
 *
 * 产物形态（契约见 @deepseek-ai/dsh-client-modules 的 ClientBundleRegistration）：
 *
 *   window.__ModuleLoader__.load({ id: "<包名>", factory: function (require) { ... } });
 *
 * `id` 必须是包名；factory 的返回值就是该包的客户端模块导出，dsh 拿它当 cordis
 * 插件加载（认 name / inject / apply）。
 *
 * react 等平台基座模块由模块系统提供，必须外置——它们是运行时从 factory 的
 * require 参数里取的，不能打进 bundle。
 */

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'iife',
  globalName: '__dshClientBundle',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: function (require) {`,
  },
  footer: { js: 'return __dshClientBundle; } });' },
});
