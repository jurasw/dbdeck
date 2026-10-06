import { build } from 'esbuild';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Compile TypeScript specs with the existing bundler, then use Node's test runner.
const entries = readdirSync('test', { recursive: true })
  .filter((file) => file.endsWith('.spec.ts'))
  .map((file) => join('test', file));
if (!entries.length) throw new Error('No test specs found');
const output = mkdtempSync(join(tmpdir(), 'dbdeck-tests-'));
try {
  await build({ entryPoints: entries, outdir: output, bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  const specs = readdirSync(output, { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .map((file) => join(output, file));
  const result = spawnSync(process.execPath, ['--test', ...specs], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
