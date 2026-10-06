import * as vscode from 'vscode';
import { RedisDriver } from './drivers/redis';
import { errorMessage } from './util';

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m' };

export function openRedisCli(driver: RedisDriver, name: string, startDb: number): void {
  const write = new vscode.EventEmitter<string>();
  const close = new vscode.EventEmitter<number | void>();
  let db = startDb;
  let line = '';
  let cursor = 0;
  const history: string[] = [];
  let hIndex = -1;
  let busy = false;
  const prompt = () => `${C.cyan}${name}${C.reset}${C.dim}[db${db}]${C.reset}> `;
  const redraw = () => write.fire(`\r\x1b[2K${prompt()}${line}${cursor < line.length ? `\x1b[${line.length - cursor}D` : ''}`);

  const submit = async () => {
    const cmd = line.trim();
    write.fire('\r\n');
    line = '';
    cursor = 0;
    hIndex = -1;
    if (!cmd) return redraw();
    history.unshift(cmd);
    const args = tokenize(cmd);
    const name0 = args[0].toUpperCase();
    if (name0 === 'CLEAR') {
      write.fire('\x1b[2J\x1b[3J\x1b[H');
      return redraw();
    }
    if (name0 === 'EXIT' || name0 === 'QUIT') return close.fire();
    busy = true;
    try {
      if (name0 === 'SELECT') {
        const n = Number(args[1]);
        if (!Number.isInteger(n)) throw new Error('ERR invalid DB index');
        await driver.client(n);
        db = n;
        write.fire(`${C.green}OK${C.reset}\r\n`);
      } else {
        const t = Date.now();
        const r = await driver.exec(db, args);
        write.fire(format(r).replace(/\n/g, '\r\n') + `\r\n${C.dim}(${Date.now() - t} ms)${C.reset}\r\n`);
      }
    } catch (e) {
      write.fire(`${C.red}(error) ${errorMessage(e)}${C.reset}\r\n`);
    } finally {
      busy = false;
      redraw();
    }
  };

  const pty: vscode.Pseudoterminal = {
    onDidWrite: write.event,
    onDidClose: close.event,
    open: () => {
      write.fire(`${C.magenta}DBDeck Redis CLI${C.reset} ${C.dim}— type commands, ↑/↓ history, "clear", "exit"${C.reset}\r\n`);
      redraw();
    },
    close: () => undefined,
    handleInput: (data) => {
      if (busy) return;
      if (data === '\r') return void submit();
      if (data === '\x7f') {
        if (cursor > 0) {
          line = line.slice(0, cursor - 1) + line.slice(cursor);
          cursor--;
        }
      } else if (data === '\x1b[A') {
        if (hIndex < history.length - 1) line = history[++hIndex];
        cursor = line.length;
      } else if (data === '\x1b[B') {
        line = hIndex > 0 ? history[--hIndex] : ((hIndex = -1), '');
        cursor = line.length;
      } else if (data === '\x1b[D') cursor = Math.max(0, cursor - 1);
      else if (data === '\x1b[C') cursor = Math.min(line.length, cursor + 1);
      else if (data === '\x01' || data === '\x1b[H') cursor = 0;
      else if (data === '\x05' || data === '\x1b[F') cursor = line.length;
      else if (data === '\x03') {
        line = '';
        cursor = 0;
        write.fire('^C\r\n');
      } else if (data === '\x15') {
        line = line.slice(cursor);
        cursor = 0;
      } else if (data === '\x0c') write.fire('\x1b[2J\x1b[3J\x1b[H');
      else if (!data.startsWith('\x1b')) {
        const clean = data.replace(/[\r\n]+/g, ' ');
        line = line.slice(0, cursor) + clean + line.slice(cursor);
        cursor += clean.length;
      }
      redraw();
    },
  };
  const term = vscode.window.createTerminal({ name: `Redis: ${name}`, pty, iconPath: new vscode.ThemeIcon('terminal') });
  term.show();
}

export function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, (_x, c) => ({ n: '\n', t: '\t', r: '\r' })[c as 'n'] ?? c));
    else if (m[2] !== undefined) out.push(m[2].replace(/\\'/g, "'"));
    else out.push(m[3]);
  }
  return out;
}

function format(v: unknown, indent = ''): string {
  if (v === null || v === undefined) return `${C.dim}(nil)${C.reset}`;
  if (typeof v === 'number') return `${C.yellow}(integer) ${v}${C.reset}`;
  if (Buffer.isBuffer(v)) return `"${v.toString('utf8')}"`;
  if (Array.isArray(v)) {
    if (!v.length) return `${C.dim}(empty array)${C.reset}`;
    const w = String(v.length).length;
    return v.map((x, i) => `${i ? indent : ''}${String(i + 1).padStart(w)}) ${format(x, indent + ' '.repeat(w + 2))}`).join('\n');
  }
  if (typeof v === 'string') return v === 'OK' ? `${C.green}OK${C.reset}` : `"${v}"`;
  return JSON.stringify(v);
}
