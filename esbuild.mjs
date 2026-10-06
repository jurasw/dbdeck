import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

if (production) rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/webview', { recursive: true });
cpSync('node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicon.css');
cpSync('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicon.ttf');
cpSync('webview/style.css', 'dist/webview/style.css');

const common = { bundle: true, minify: production, sourcemap: !production, logLevel: 'info' };

const extension = await esbuild.context({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: [
    'vscode',
    'cpu-features',
    'pg-native',
    'kerberos',
    '@mongodb-js/zstd',
    '@aws-sdk/credential-providers',
    'gcp-metadata',
    'snappy',
    'socks',
    'aws4',
    'mongodb-client-encryption',
  ],
  loader: { '.node': 'empty' },
});

const webview = await esbuild.context({
  ...common,
  entryPoints: ['webview/connection.ts', 'webview/data.ts', 'webview/results.ts', 'webview/redis.ts'],
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});

if (watch) {
  await Promise.all([extension.watch(), webview.watch()]);
} else {
  await Promise.all([extension.rebuild(), webview.rebuild()]);
  await Promise.all([extension.dispose(), webview.dispose()]);
}
