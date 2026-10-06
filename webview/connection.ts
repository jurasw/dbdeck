import { btn, clear, h, icon, INIT, rpc } from './lib';

type DbType = 'mysql' | 'postgres' | 'clickhouse' | 'mongodb' | 'redis' | 'elasticsearch' | 'docker';

interface Ssh {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

interface Conn {
  id?: string;
  name: string;
  type: DbType;
  group?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
  useUri?: boolean;
  uri?: string;
  authSource?: string;
  apiKey?: string;
  useSocket?: boolean;
  socketPath?: string;
  showSystem?: boolean;
  readonly?: boolean;
  savePassword?: boolean;
  ssh?: Ssh;
}

const I = INIT as { connection: Partial<Conn> | null; defaults: Record<DbType, number>; dockerSocket: string; groups: string[]; icons: Record<DbType, string> };

const TYPES: { type: DbType; label: string; hint: string }[] = [
  { type: 'postgres', label: 'PostgreSQL', hint: 'Postgres, Timescale, Supabase, Neon' },
  { type: 'mysql', label: 'MySQL', hint: 'MySQL, MariaDB, TiDB, PlanetScale' },
  { type: 'clickhouse', label: 'ClickHouse', hint: 'HTTP interface' },
  { type: 'mongodb', label: 'MongoDB', hint: 'Host or connection string' },
  { type: 'redis', label: 'Redis', hint: 'Redis, Valkey, KeyDB, Dragonfly' },
  { type: 'elasticsearch', label: 'Elasticsearch', hint: 'Elasticsearch, OpenSearch' },
  { type: 'docker', label: 'Docker', hint: 'Containers, images, volumes' },
];

const DEFAULT_USER: Partial<Record<DbType, string>> = { postgres: 'postgres', mysql: 'root', clickhouse: 'default' };

const isNew = !I.connection?.id;
const c: Conn = {
  name: '',
  type: 'postgres',
  host: '127.0.0.1',
  rejectUnauthorized: false,
  useSocket: true,
  ...I.connection,
  ssh: { enabled: false, host: '', port: 22, username: '', authType: 'password', ...I.connection?.ssh },
} as Conn;
if (isNew && !c.user && !I.connection?.type) c.user = DEFAULT_USER[c.type];
let sshOpen = !!c.ssh?.enabled;
let advancedOpen = !!(c.showSystem || c.readonly || c.ssl);
let status: { kind: 'ok' | 'err' | 'busy'; text: string } | null = null;
const app = document.getElementById('app')!;

function field(label: string, input: HTMLElement, cls = '', hint?: string): HTMLElement {
  return h('div.field', { class: cls }, h('label', null, label), input, hint ? h('div.hint', null, hint) : null);
}

function text(key: keyof Conn, opts: { placeholder?: string; type?: string; mono?: boolean } = {}): HTMLInputElement {
  const el = h('input.input', {
    class: opts.mono ? 'mono' : '',
    type: opts.type ?? 'text',
    value: (c[key] as string | number | undefined) ?? '',
    placeholder: opts.placeholder ?? '',
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement;
  el.addEventListener('input', () => {
    (c as unknown as Record<string, unknown>)[key] = el.type === 'number' ? (el.value ? Number(el.value) : undefined) : el.value;
    if (key === 'host' || key === 'name') updateTitle();
  });
  return el;
}

function sshText(key: keyof Ssh, opts: { placeholder?: string; type?: string } = {}): HTMLInputElement {
  const el = h('input.input', {
    type: opts.type ?? 'text',
    value: (c.ssh![key] as string | number | undefined) ?? '',
    placeholder: opts.placeholder ?? '',
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement;
  el.addEventListener('input', () => ((c.ssh as unknown as Record<string, unknown>)[key] = opts.type === 'number' ? Number(el.value) : el.value));
  return el;
}

function password(get: () => string | undefined, set: (v: string) => void, placeholder = ''): HTMLElement {
  const el = h('input.input', { type: 'password', value: get() ?? '', placeholder, autocomplete: 'new-password', style: 'width:100%;padding-right:32px' }) as HTMLInputElement;
  el.addEventListener('input', () => set(el.value));
  const eye = btn(null, {
    icon: 'eye',
    class: 'ghost sm',
    title: 'Show / hide',
    onClick: () => {
      el.type = el.type === 'password' ? 'text' : 'password';
      eye.firstElementChild!.className = `codicon codicon-${el.type === 'password' ? 'eye' : 'eye-closed'}`;
    },
  });
  eye.style.cssText = 'position:absolute;right:2px';
  return h('div.input-wrap', null, el, eye);
}

function toggle(label: string, hint: string, get: () => boolean, set: (v: boolean) => void, rerender = false): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: get() }) as HTMLInputElement;
  input.addEventListener('change', () => {
    set(input.checked);
    if (rerender) render();
  });
  return h('label.switch', null, input, h('span.knob'), h('span.lbl', null, label, hint ? h('small', null, hint) : null));
}

function section(title: string, ic: string, body: HTMLElement[], collapsible?: { open: boolean; onToggle: (o: boolean) => void; badge?: string }): HTMLElement {
  const sec = h('div.section', { class: collapsible && !collapsible.open ? 'collapsed' : '' });
  const head = h(
    'div.s-head',
    { class: collapsible ? 'toggle' : '' },
    collapsible ? icon(collapsible.open ? 'chevron-down' : 'chevron-right') : icon(ic),
    title,
    collapsible?.badge ? h('span.badge.ok', { style: 'margin-left:4px' }, collapsible.badge) : null,
  );
  if (collapsible)
    head.addEventListener('click', () => {
      collapsible.onToggle(!collapsible.open);
      render();
    });
  sec.append(head, h('div.s-body', null, body));
  return sec;
}

const titleEl = h('h1');
function updateTitle(): void {
  const t = TYPES.find((x) => x.type === c.type)!;
  clear(titleEl, h('img', { src: I.icons[c.type], width: '26', height: '26' }), isNew ? `New ${t.label} connection` : `Edit ${c.name || t.label}`);
}

function serverFields(): HTMLElement[] {
  const t = c.type;
  const portPh = String(I.defaults[t]);
  if (t === 'docker') {
    const out: HTMLElement[] = [toggle('Local Docker socket', 'Docker Desktop, OrbStack, Colima, Rancher', () => c.useSocket !== false, (v) => (c.useSocket = v), true)];
    if (c.useSocket !== false) out.push(field('Socket path', text('socketPath', { placeholder: I.dockerSocket, mono: true }), 'w12', 'Leave empty to detect automatically.'));
    else out.push(field('Host', text('host', { placeholder: '127.0.0.1' }), 'w8'), field('Port', text('port', { placeholder: '2375', type: 'number' }), 'w4'));
    return out;
  }
  if (t === 'mongodb') {
    const out: HTMLElement[] = [toggle('Use connection string', 'mongodb:// or mongodb+srv:// URI', () => !!c.useUri, (v) => (c.useUri = v), true)];
    if (c.useUri) {
      const ta = h('textarea.textarea', { rows: '3', placeholder: 'mongodb+srv://user:pass@cluster.example.net/mydb?retryWrites=true', spellcheck: 'false' }) as HTMLTextAreaElement;
      ta.value = c.uri ?? '';
      ta.addEventListener('input', () => (c.uri = ta.value));
      out.push(field('Connection string', ta, 'w12', 'Stored in the OS keychain via VS Code SecretStorage.'));
      out.push(field('Default database', text('database', { placeholder: 'optional' }), 'w6'));
      return out;
    }
    out.push(
      field('Host', text('host', { placeholder: '127.0.0.1' }), 'w8'),
      field('Port', text('port', { placeholder: portPh, type: 'number' }), 'w4'),
      field('Username', text('user', { placeholder: 'optional' }), 'w4'),
      field('Password', password(() => c.password, (v) => (c.password = v)), 'w4'),
      field('Auth database', text('authSource', { placeholder: 'admin' }), 'w4'),
      field('Default database', text('database', { placeholder: 'optional' }), 'w6'),
    );
    return out;
  }
  const out: HTMLElement[] = [field('Host', text('host', { placeholder: '127.0.0.1' }), 'w8'), field('Port', text('port', { placeholder: portPh, type: 'number' }), 'w4')];
  if (t === 'elasticsearch') {
    out.push(
      field('Username', text('user', { placeholder: 'elastic' }), 'w4'),
      field('Password', password(() => c.password, (v) => (c.password = v)), 'w4'),
      field('API key', password(() => c.apiKey, (v) => (c.apiKey = v), 'base64 id:key'), 'w4', 'Used instead of username/password.'),
    );
    return out;
  }
  if (t === 'redis') {
    out.push(
      field('Username', text('user', { placeholder: 'default (ACL)' }), 'w4'),
      field('Password', password(() => c.password, (v) => (c.password = v)), 'w4'),
      field('Database index', text('database', { placeholder: '0' }), 'w4'),
    );
    return out;
  }
  out.push(
    field('Username', text('user', { placeholder: DEFAULT_USER[t] ?? '' }), 'w4'),
    field('Password', password(() => c.password, (v) => (c.password = v)), 'w4'),
    field('Database', text('database', { placeholder: t === 'postgres' ? 'postgres' : 'optional' }), 'w4', t === 'postgres' ? 'All databases are listed; this one is opened first.' : undefined),
  );
  return out;
}

function render(): void {
  updateTitle();
  const typeCards = h(
    'div.types',
    null,
    TYPES.map((t) =>
      h(
        'div.type-card',
        {
          class: t.type === c.type ? 'active' : '',
          title: t.hint,
          onClick: () => {
            if (c.type === t.type) return;
            const prevDefault = !c.port || c.port === I.defaults[c.type];
            const prevUser = !c.user || c.user === DEFAULT_USER[c.type];
            c.type = t.type;
            if (prevDefault) c.port = undefined;
            if (prevUser) c.user = DEFAULT_USER[t.type];
            status = null;
            render();
          },
        },
        h('img', { src: I.icons[t.type], alt: '' }),
        t.label,
      ),
    ),
  );
  const groupInput = text('group', { placeholder: 'e.g. Production' });
  groupInput.setAttribute('list', 'groups');
  const general = section('General', 'settings', [
    field('Name', text('name', { placeholder: `My ${TYPES.find((x) => x.type === c.type)!.label}` }), 'w8'),
    field('Group', groupInput, 'w4'),
    h('datalist', { id: 'groups' }, I.groups.map((g) => h('option', { value: g }))),
  ]);
  const serverBody = serverFields();
  if (c.type !== 'docker')
    serverBody.push(
      toggle(
        'Remember password',
        'On: OS keychain. Off: asked on connect, kept in memory only.',
        () => c.savePassword !== false,
        (v) => (c.savePassword = v),
      ),
    );
  const server = section(c.type === 'docker' ? 'Docker engine' : 'Server', c.type === 'docker' ? 'vm' : 'server', serverBody);
  const advanced = section(
    'Options',
    'settings-gear',
    [
      c.type !== 'docker' || c.useSocket === false ? toggle('Use SSL / TLS', 'Encrypt the connection', () => !!c.ssl, (v) => (c.ssl = v), true) : null,
      c.ssl ? toggle('Verify server certificate', 'Turn off for self-signed certificates', () => !!c.rejectUnauthorized, (v) => (c.rejectUnauthorized = v)) : null,
      c.type !== 'docker' ? toggle('Show system objects', 'System databases, schemas, empty Redis DBs', () => !!c.showSystem, (v) => (c.showSystem = v)) : null,
      c.type !== 'docker' ? toggle('Read-only', 'Block writes from the data viewer and editors', () => !!c.readonly, (v) => (c.readonly = v)) : null,
    ].filter(Boolean) as HTMLElement[],
    { open: advancedOpen, onToggle: (o) => (advancedOpen = o) },
  );
  const ssh = c.ssh!;
  const sshBody: HTMLElement[] = [
    toggle('Connect through an SSH tunnel', 'Traffic is forwarded through a bastion host', () => ssh.enabled, (v) => (ssh.enabled = v), true),
  ];
  if (ssh.enabled) {
    sshBody.push(
      field('SSH host', sshText('host', { placeholder: 'bastion.example.com' }), 'w8'),
      field('SSH port', sshText('port', { placeholder: '22', type: 'number' }), 'w4'),
      field('SSH user', sshText('username', { placeholder: 'ubuntu' }), 'w4'),
    );
    const authSel = h(
      'select.select',
      null,
      h('option', { value: 'password', selected: ssh.authType === 'password' }, 'Password'),
      h('option', { value: 'key', selected: ssh.authType === 'key' }, 'Private key'),
    ) as HTMLSelectElement;
    authSel.addEventListener('change', () => {
      ssh.authType = authSel.value as Ssh['authType'];
      render();
    });
    sshBody.push(field('Authentication', authSel, 'w4'));
    if (ssh.authType === 'password') sshBody.push(field('SSH password', password(() => ssh.password, (v) => (ssh.password = v)), 'w4'));
    else {
      const keyInput = sshText('privateKeyPath', { placeholder: '~/.ssh/id_ed25519' });
      keyInput.style.flex = '1';
      sshBody.push(
        field(
          'Private key',
          h(
            'div.row',
            { style: 'gap:6px' },
            keyInput,
            btn(null, {
              icon: 'folder-opened',
              class: 'sm',
              title: 'Browse',
              onClick: async () => {
                const p = await rpc<string | undefined>('pickKey');
                if (p) keyInput.value = ssh.privateKeyPath = p;
              },
            }),
          ),
          'w8',
        ),
        field('Passphrase', password(() => ssh.passphrase, (v) => (ssh.passphrase = v), 'optional'), 'w4'),
      );
    }
  }
  const sshSec =
    c.type === 'docker' && c.useSocket !== false
      ? null
      : section('SSH tunnel', 'remote', sshBody, { open: sshOpen, onToggle: (o) => (sshOpen = o), badge: ssh.enabled ? 'on' : undefined });

  const statusEl = h(
    'div.status',
    { class: status?.kind === 'ok' ? 'ok' : status?.kind === 'err' ? 'err' : '' },
    status ? (status.kind === 'busy' ? h('div.spinner', { style: 'width:14px;height:14px;border-width:2px' }) : icon(status.kind === 'ok' ? 'pass-filled' : 'error')) : null,
    status ? h('span', { title: status.text }, status.text) : null,
  );

  clear(
    app,
    h(
      'div.form-page',
      null,
      h(
        'div.form',
        null,
        titleEl,
        h('div.sub', null, 'Everything stays on this machine. No accounts, no telemetry, no cloud sync.'),
        isNew ? typeCards : null,
        general,
        server,
        sshSec,
        advanced,
      ),
    ),
    h(
      'div.form-foot',
      null,
      statusEl,
      btn('Test connection', { icon: 'plug', onClick: test }),
      btn('Cancel', { class: 'ghost', onClick: () => rpc('cancel') }),
      btn('Save', { icon: 'check', class: 'primary', onClick: save }),
    ),
  );
}

function payload(): Conn {
  return JSON.parse(JSON.stringify({ ...c, name: c.name || `${TYPES.find((x) => x.type === c.type)!.label} ${c.host ?? ''}`.trim() }));
}

async function test(): Promise<void> {
  status = { kind: 'busy', text: 'Connecting…' };
  render();
  try {
    status = { kind: 'ok', text: await rpc<string>('test', payload()) };
  } catch (e) {
    status = { kind: 'err', text: (e as Error).message };
  }
  render();
}

async function save(): Promise<void> {
  try {
    await rpc('save', payload());
  } catch (e) {
    status = { kind: 'err', text: (e as Error).message };
    render();
  }
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
});

render();
