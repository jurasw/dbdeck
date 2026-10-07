import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, ChevronRight, CircleAlert, CircleCheck, Eye, EyeOff, FolderOpen, Loader2, LogIn, Plug, Server, Settings, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { parseConnectionUrl } from './connection-url';
import { INIT, rpc } from './lib';

type DbType = 'mysql' | 'postgres' | 'sqlite' | 'clickhouse' | 'bigquery' | 'snowflake' | 'mongodb' | 'redis' | 'elasticsearch' | 'docker' | 's3';

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
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  googleAuth?: boolean;
  kibanaUrl?: string;
  googleEmail?: string;
  project?: string;
  keyFile?: string;
  warehouse?: string;
  role?: string;
  authMethod?: 'token' | 'keyPair';
  showSystem?: boolean;
  readonly?: boolean;
  savePassword?: boolean;
  ssh?: Ssh;
}

type Status = { kind: 'ok' | 'err' | 'busy'; text: string } | null;

const I = INIT as { connection: Partial<Conn> | null; defaults: Record<DbType, number>; dockerSocket: string; groups: string[]; icons: Record<DbType, string> };

const TYPES: { type: DbType; label: string; hint: string }[] = [
  { type: 'postgres', label: 'PostgreSQL', hint: 'Postgres, Timescale, Supabase, Neon' },
  { type: 'mysql', label: 'MySQL', hint: 'MySQL, MariaDB, TiDB, PlanetScale' },
  { type: 'sqlite', label: 'SQLite', hint: 'Local .db, .sqlite and .sqlite3 files' },
  { type: 'clickhouse', label: 'ClickHouse', hint: 'HTTP interface' },
  { type: 'bigquery', label: 'BigQuery', hint: 'Google BigQuery · gcloud credentials or a service account key' },
  { type: 'snowflake', label: 'Snowflake', hint: 'Programmatic access token or key pair' },
  { type: 'mongodb', label: 'MongoDB', hint: 'Host or connection string' },
  { type: 'redis', label: 'Redis', hint: 'Redis, Valkey, KeyDB, Dragonfly' },
  { type: 'elasticsearch', label: 'Elasticsearch', hint: 'Elasticsearch, OpenSearch' },
  { type: 's3', label: 'S3', hint: 'AWS S3, MinIO, Cloudflare R2, Wasabi, Backblaze B2' },
  { type: 'docker', label: 'Docker', hint: 'Containers, images, volumes' },
];

const DEFAULT_USER: Partial<Record<DbType, string>> = { postgres: 'postgres', mysql: 'root', clickhouse: 'default' };

const URL_TYPES = new Set<DbType>(['postgres', 'mysql', 'clickhouse', 'redis']);

const URL_PLACEHOLDER: Partial<Record<DbType, string>> = {
  postgres: 'postgresql://user:password@host:5432/database?sslmode=require',
  mysql: 'mysql://user:password@host:3306/database',
  clickhouse: 'clickhouse://user:password@host:8123/database',
  redis: 'redis://user:password@host:6379/0',
};

const SPAN = { 4: 'col-span-4', 6: 'col-span-6', 8: 'col-span-8', 12: 'col-span-12' } as const;

const isNew = !I.connection?.id;

function initial(): Conn {
  const c = {
    name: '',
    type: 'postgres',
    host: '127.0.0.1',
    rejectUnauthorized: I.connection?.type === 's3',
    useSocket: true,
    ...I.connection,
    ssh: { enabled: false, host: '', port: 22, username: '', authType: 'password', ...I.connection?.ssh },
  } as Conn;
  if (isNew && !c.user && !I.connection?.type) c.user = DEFAULT_USER[c.type];
  return c;
}

function Field({ label, hint, span = 6, htmlFor, children }: { label: string; hint?: string; span?: keyof typeof SPAN; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 max-[620px]:col-span-12', SPAN[span])}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PasswordInput({ id, value, placeholder, onChange }: { id: string; value?: string; placeholder?: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value ?? ''}
        placeholder={placeholder}
        autoComplete="new-password"
        className="h-8 pr-9"
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title="Show / hide"
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="col-span-6 flex items-center gap-3 py-1 max-[620px]:col-span-12">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <Label htmlFor={id} className="flex cursor-pointer flex-col items-start gap-1 font-normal">
        <span className="text-[13px]">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </Label>
    </div>
  );
}

function Section({
  icon,
  title,
  badge,
  open,
  onOpenChange,
  children,
}: {
  icon?: ReactNode;
  title: string;
  badge?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  children: ReactNode;
}) {
  const body = <div className="grid grid-cols-12 gap-3 px-4 pt-1 pb-4">{children}</div>;
  const head = 'flex w-full items-center gap-2 px-4 py-3 text-left text-[12.5px] font-semibold [&>svg]:size-4 [&>svg]:text-muted-foreground';
  if (open === undefined)
    return (
      <Card className="gap-0 py-0 shadow-none">
        <div className={head}>
          {icon}
          {title}
        </div>
        {body}
      </Card>
    );
  return (
    <Card className="gap-0 py-0 shadow-none">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className={cn(head, 'cursor-pointer rounded-xl outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50')}>
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
          {title}
          {badge && <Badge className="ml-1 bg-success/15 text-success">{badge}</Badge>}
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function App() {
  const [c, setC] = useState<Conn>(initial);
  const [status, setStatus] = useState<Status>(null);
  const [sshOpen, setSshOpen] = useState(!!c.ssh?.enabled);
  const [optionsOpen, setOptionsOpen] = useState(!!(c.showSystem || c.readonly || c.ssl || c.googleAuth || c.kibanaUrl));
  const meta = TYPES.find((x) => x.type === c.type)!;
  const ssh = c.ssh!;

  const set = (patch: Partial<Conn>) => setC((p) => ({ ...p, ...patch }));
  const setSsh = (patch: Partial<Ssh>) => setC((p) => ({ ...p, ssh: { ...p.ssh!, ...patch } }));

  const text = (key: keyof Conn, placeholder = '', type = 'text', mono = false) => (
    <Input
      id={key}
      type={type}
      value={(c[key] as string | number | undefined) ?? ''}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={cn('h-8', mono && 'font-mono text-xs')}
      onChange={(e) => set({ [key]: type === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value })}
    />
  );

  const sshText = (key: keyof Ssh, placeholder = '', type = 'text') => (
    <Input
      id={`ssh-${key}`}
      type={type}
      value={(ssh[key] as string | number | undefined) ?? ''}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className="h-8"
      onChange={(e) => setSsh({ [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
    />
  );

  const password = (id: string, get: string | undefined, onChange: (v: string) => void, placeholder?: string) => (
    <PasswordInput id={id} value={get} placeholder={placeholder} onChange={onChange} />
  );

  const pickType = (type: DbType) => {
    if (type === c.type) return;
    setC((p) => ({
      ...p,
      type,
      port: !p.port || p.port === I.defaults[p.type] ? undefined : p.port,
      user: !p.user || p.user === DEFAULT_USER[p.type] ? DEFAULT_USER[type] : p.user,
      rejectUnauthorized: isNew ? type === 's3' : p.rejectUnauthorized,
    }));
    setStatus(null);
  };

  const fallbackName = c.googleAuth
    ? `GCS ${c.database || c.project || ''}`
    : c.type === 'sqlite'
      ? `${meta.label} ${c.database?.split(/[\\/]/).pop() ?? ''}`
      : c.type === 'bigquery'
        ? `${meta.label} ${c.project || c.database || ''}`
        : `${meta.label} ${c.endpoint || c.host || ''}`;
  const payload = (): Conn => JSON.parse(JSON.stringify({ ...c, name: c.name || fallbackName.trim() }));

  const [google, setGoogle] = useState<{ email?: string; project?: string } | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [buckets, setBuckets] = useState<string[] | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const wantsGoogle = c.type === 's3' || c.type === 'bigquery';
  const usesGoogle = !!c.googleAuth || (c.type === 'bigquery' && !c.keyFile);

  useEffect(() => {
    if (wantsGoogle) void rpc<{ email?: string; project?: string } | null>('googleStatus').then(setGoogle);
  }, [wantsGoogle]);

  useEffect(() => {
    if (!usesGoogle || !google) return;
    rpc<{ id: string; name: string }[]>('googleProjects')
      .then(setProjects)
      .catch(() => setProjects(null));
  }, [usesGoogle, google]);

  useEffect(() => {
    setBuckets(null);
    if (!c.googleAuth || !google || !c.project) return;
    rpc<string[]>('googleBuckets', { project: c.project })
      .then(setBuckets)
      .catch((e: Error) => setStatus({ kind: 'err', text: e.message }));
  }, [c.googleAuth, google, c.project]);

  const applyGoogle = (identity: { email?: string; project?: string }) =>
    setC((p) => ({ ...p, googleAuth: true, googleEmail: identity.email, project: p.project || identity.project, user: undefined, password: undefined }));

  const googleSignIn = async () => {
    setGoogleBusy(true);
    setStatus({ kind: 'busy', text: 'Finish sign-in in your browser…' });
    try {
      const identity = await rpc<{ email?: string; project?: string }>('googleSignIn');
      setGoogle(identity);
      if (c.type === 's3') applyGoogle(identity);
      else setC((p) => ({ ...p, keyFile: undefined, project: p.project || identity.project }));
      setStatus({ kind: 'ok', text: identity.email ? `Signed in as ${identity.email}` : 'Signed in with Google' });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    } finally {
      setGoogleBusy(false);
    }
  };

  const projectField = (hint?: string) => (
    <Field label={c.type === 'bigquery' ? 'Project ID' : 'Project'} span={6} htmlFor="project" hint={hint}>
      {usesGoogle && projects?.length ? (
        <Select value={c.project || undefined} onValueChange={(v) => set({ project: v, database: undefined })}>
          <SelectTrigger id="project" size="sm" className="w-full">
            <SelectValue placeholder="Choose a project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name === p.id ? p.id : `${p.name} (${p.id})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        text('project', 'my-project-123', 'text', true)
      )}
    </Field>
  );

  const bigQueryGoogle = (): ReactNode => (
    <div className="col-span-12 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Google account</span>
        <span className="text-[11px] text-muted-foreground">
          {c.keyFile
            ? 'This connection uses the credentials file above.'
            : google?.email
              ? `Signed in as ${google.email}. DBDeck uses your gcloud login, shared with gcloud tools and Cloud Storage.`
              : 'Sign in with Google to use BigQuery without a key file.'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {google?.email && c.keyFile && (
          <Button type="button" variant="outline" size="sm" disabled={googleBusy} onClick={() => set({ keyFile: undefined, project: c.project || google.project })}>
            <LogIn />
            Use {google.email} instead
          </Button>
        )}
        <Button type="button" variant={google?.email ? 'ghost' : 'outline'} size="sm" disabled={googleBusy} onClick={googleSignIn}>
          {googleBusy ? <Loader2 className="animate-spin" /> : !google?.email && <LogIn />}
          {google?.email ? 'Use another account' : 'Sign in with Google'}
        </Button>
      </div>
    </div>
  );

  const [kibanaDraft, setKibanaDraft] = useState(c.kibanaUrl ?? '');
  const [kibanaBusy, setKibanaBusy] = useState(false);

  const kibanaSignIn = async () => {
    setKibanaBusy(true);
    setStatus({ kind: 'busy', text: 'Sign in to Kibana in your browser, then paste the API key…' });
    try {
      const r = await rpc<{ kibana: string; apiKey: string } | null>('kibanaSignIn', { url: kibanaDraft });
      if (!r) return setStatus(null);
      const next: Conn = { ...c, kibanaUrl: r.kibana, apiKey: r.apiKey, user: undefined, password: undefined, rejectUnauthorized: true, ssh: { ...c.ssh!, enabled: false } };
      setC(next);
      setKibanaDraft(r.kibana);
      setStatus({ kind: 'busy', text: 'Connecting through Kibana…' });
      setStatus({ kind: 'ok', text: await rpc<string>('test', JSON.parse(JSON.stringify({ ...next, name: next.name || 'Elasticsearch' }))) });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    } finally {
      setKibanaBusy(false);
    }
  };

  const kibanaOptions = (): ReactNode => (
    <div className="col-span-12 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Kibana sign-in</span>
        <span className="text-[11px] text-muted-foreground">
          {c.kibanaUrl
            ? `Connected through ${c.kibanaUrl} with an API key. Works with company SSO and Elastic Cloud.`
            : 'Use your Kibana account (company SSO, Elastic Cloud) instead of host and password. Kibana opens in your browser; create an API key there and paste it.'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="kibanaUrl"
          value={kibanaDraft}
          placeholder="https://kibana.example.com"
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-64 flex-1 font-mono text-xs"
          onChange={(e) => setKibanaDraft(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" disabled={!kibanaDraft.trim() || kibanaBusy} onClick={kibanaSignIn}>
          {kibanaBusy ? <Loader2 className="animate-spin" /> : <LogIn />}
          {c.kibanaUrl ? 'Create a new API key' : 'Sign in to Kibana'}
        </Button>
        {c.kibanaUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={() => set({ kibanaUrl: undefined, apiKey: undefined })}>
            Use host and password instead
          </Button>
        )}
      </div>
    </div>
  );

  const googleOptions = (): ReactNode => (
    <div className="col-span-12 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Google Cloud Storage</span>
        <span className="text-[11px] text-muted-foreground">
          {c.googleAuth
            ? `Signed in as ${c.googleEmail ?? 'your Google account'}. DBDeck uses your gcloud login, shared with gcloud tools and BigQuery.`
            : 'Open a Google Cloud Storage bucket with your Google account instead of S3 keys.'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!c.googleAuth && google?.email && (
          <Button type="button" variant="outline" size="sm" disabled={googleBusy} onClick={() => applyGoogle(google)}>
            <LogIn />
            Continue as {google.email}
          </Button>
        )}
        {!c.googleAuth && !google?.email ? (
          <Button type="button" variant="outline" size="sm" disabled={googleBusy} onClick={googleSignIn}>
            {googleBusy ? <Loader2 className="animate-spin" /> : <LogIn />}
            Sign in with Google
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={googleBusy} onClick={googleSignIn}>
            {googleBusy && <Loader2 className="animate-spin" />}
            Use another account
          </Button>
        )}
        {c.googleAuth && (
          <Button type="button" variant="ghost" size="sm" onClick={() => set({ googleAuth: false, googleEmail: undefined, database: undefined })}>
            Use S3 keys instead
          </Button>
        )}
      </div>
      {c.googleAuth && (
        <div className="grid grid-cols-12 gap-3">
          {projectField()}
          <Field label="Bucket" span={6} htmlFor="bucket">
            {buckets ? (
              <Select value={c.database || '*'} onValueChange={(v) => set({ database: v === '*' ? undefined : v })}>
                <SelectTrigger id="bucket" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">All buckets in the project</SelectItem>
                  {buckets.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              text('database', c.project ? 'loading buckets…' : 'choose a project first', 'text', true)
            )}
          </Field>
        </div>
      )}
    </div>
  );

  const [urlDraft, setUrlDraft] = useState('');

  const applyUrl = (value: string) => {
    if (!value.trim()) return;
    const parsed = parseConnectionUrl(value);
    if (!parsed) {
      setUrlDraft(value);
      setStatus({ kind: 'err', text: 'Not a connection URL. Use postgresql://, mysql://, clickhouse://, redis:// or sqlite://.' });
      return;
    }
    const label = TYPES.find((x) => x.type === parsed.type)!.label;
    if (parsed.type !== c.type && !isNew) {
      setUrlDraft(value);
      setStatus({ kind: 'err', text: `This is a ${label} URL. Add it as a new connection.` });
      return;
    }
    const { type, ssl, rejectUnauthorized, ...fields } = parsed;
    setC((p) => ({
      ...p,
      type,
      host: fields.host ?? p.host,
      port: fields.port,
      user: fields.user,
      password: fields.password,
      database: fields.database,
      ...(ssl === undefined ? {} : { ssl, rejectUnauthorized: rejectUnauthorized ?? p.rejectUnauthorized }),
    }));
    if (ssl) setOptionsOpen(true);
    setUrlDraft('');
    setStatus({ kind: 'ok', text: `Filled the ${label} fields from the URL. Check them, then test the connection.` });
  };

  const urlField = (t: DbType) => (
    <Field
      label="Connection URL"
      span={12}
      htmlFor="connectionUrl"
      hint="Paste a URL from Neon, Supabase, PlanetScale, Heroku, Railway or Render. DBDeck fills the fields below and does not keep the URL."
    >
      <Input
        id="connectionUrl"
        value={urlDraft}
        placeholder={URL_PLACEHOLDER[t]}
        spellCheck={false}
        autoComplete="off"
        className="h-8 font-mono text-xs"
        onChange={(e) => setUrlDraft(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (!pasted.includes(':')) return;
          e.preventDefault();
          applyUrl(pasted);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyUrl(urlDraft);
          }
        }}
        onBlur={() => applyUrl(urlDraft)}
      />
    </Field>
  );

  const test = async () => {
    setStatus({ kind: 'busy', text: 'Connecting…' });
    try {
      setStatus({ kind: 'ok', text: await rpc<string>('test', payload()) });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  };

  const save = async () => {
    try {
      await rpc('save', payload());
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const serverFields = (): ReactNode => {
    const t = c.type;
    const portPh = String(I.defaults[t]);
    if (t === 'docker') {
      return (
        <>
          <Toggle
            id="useSocket"
            label="Local Docker socket"
            hint="Docker Desktop, OrbStack, Colima, Rancher"
            checked={c.useSocket !== false}
            onChange={(v) => set({ useSocket: v })}
          />
          {c.useSocket !== false ? (
            <Field label="Socket path" span={12} htmlFor="socketPath" hint="Leave empty to detect automatically.">
              {text('socketPath', I.dockerSocket, 'text', true)}
            </Field>
          ) : (
            <>
              <Field label="Host" span={8} htmlFor="host">
                {text('host', '127.0.0.1')}
              </Field>
              <Field label="Port" span={4} htmlFor="port">
                {text('port', '2375', 'number')}
              </Field>
            </>
          )}
        </>
      );
    }
    const fileInput = (key: 'keyFile', placeholder: string) => (
      <div className="flex gap-1.5">
        {text(key, placeholder, 'text', true)}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title="Browse"
          onClick={async () => {
            const p = await rpc<string | undefined>('pickFile');
            if (p) set({ [key]: p });
          }}
        >
          <FolderOpen />
        </Button>
      </div>
    );
    if (t === 'sqlite') {
      return (
        <Field label="Database file" span={12} htmlFor="database" hint="A .db, .sqlite or .sqlite3 file on this computer.">
          <div className="flex gap-1.5">
            {text('database', '~/data/app.db', 'text', true)}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Browse"
              onClick={async () => {
                const p = await rpc<string | undefined>('pickSqlite');
                if (p) set({ database: p });
              }}
            >
              <FolderOpen />
            </Button>
          </div>
        </Field>
      );
    }
    if (t === 'bigquery') {
      return (
        <>
          {projectField('Queries run and are billed in this project. Empty: the project of the credentials.')}
          <Field label="Location" span={6} htmlFor="region" hint="Optional. Detected from the tables when empty.">
            {text('region', 'US, EU, europe-west1…')}
          </Field>
          <Field label="Credentials file" span={12} htmlFor="keyFile" hint="Service account key JSON. Empty: the credentials of gcloud auth application-default login.">
            {fileInput('keyFile', 'application default credentials')}
          </Field>
          <Field label="Default dataset" span={6} htmlFor="database" hint="All datasets are listed; this one is opened first.">
            {text('database', 'optional')}
          </Field>
        </>
      );
    }
    if (t === 'snowflake') {
      const keyPair = c.authMethod === 'keyPair';
      return (
        <>
          <Field label="Account" span={8} htmlFor="host" hint="Account identifier or the full account URL.">
            {text('host', 'myorg-myaccount', 'text', true)}
          </Field>
          <Field label="User" span={4} htmlFor="user">
            {text('user', 'JANE')}
          </Field>
          <Field label="Authentication" span={4}>
            <Select value={keyPair ? 'keyPair' : 'token'} onValueChange={(v) => set({ authMethod: v as Conn['authMethod'], password: undefined })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Programmatic access token</SelectItem>
                <SelectItem value="keyPair">Key pair</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {keyPair ? (
            <>
              <Field label="Private key" span={8} htmlFor="keyFile">
                {fileInput('keyFile', '~/.snowflake/rsa_key.p8')}
              </Field>
              <Field label="Passphrase" span={4} htmlFor="password">
                {password('password', c.password, (v) => set({ password: v }), 'optional')}
              </Field>
            </>
          ) : (
            <Field label="Token" span={8} htmlFor="password" hint="Create one in Snowsight: your profile › Programmatic access tokens.">
              {password('password', c.password, (v) => set({ password: v }))}
            </Field>
          )}
          <Field label="Warehouse" span={4} htmlFor="warehouse" hint="Empty: the user's default.">
            {text('warehouse', 'COMPUTE_WH')}
          </Field>
          <Field label="Role" span={4} htmlFor="role" hint="Empty: the user's default.">
            {text('role', 'ANALYST')}
          </Field>
          <Field label="Database" span={4} htmlFor="database">
            {text('database', 'optional')}
          </Field>
        </>
      );
    }
    if (t === 's3' && c.googleAuth) {
      return (
        <Field label="Google Cloud Storage" span={12} hint="Account, project and bucket are in Options below.">
          <span className="font-mono text-xs">gs://{c.database || `* (${c.project || 'no project'})`}</span>
        </Field>
      );
    }
    if (t === 's3') {
      return (
        <>
          <Field label="Endpoint" span={8} htmlFor="endpoint" hint={`Empty for AWS. MinIO: http://127.0.0.1:9000 · R2: https://<account>.r2.cloudflarestorage.com`}>
            {text('endpoint', 'https://s3.amazonaws.com', 'text', true)}
          </Field>
          <Field label="Region" span={4} htmlFor="region">
            {text('region', 'us-east-1')}
          </Field>
          <Field label="Access key ID" span={4} htmlFor="user" hint="Empty: AWS default credentials (env, ~/.aws, SSO).">
            {text('user', 'AKIA…', 'text', true)}
          </Field>
          <Field label="Secret access key" span={4} htmlFor="password">
            {password('password', c.password, (v) => set({ password: v }))}
          </Field>
          <Field label="Bucket" span={4} htmlFor="database" hint="Set it when the key cannot list buckets.">
            {text('database', 'all buckets')}
          </Field>
          <Toggle
            id="forcePathStyle"
            label="Path-style URLs"
            hint="Needed for MinIO and most S3-compatible servers"
            checked={!!c.forcePathStyle}
            onChange={(v) => set({ forcePathStyle: v })}
          />
        </>
      );
    }
    if (t === 'mongodb') {
      return (
        <>
          <Toggle id="useUri" label="Use connection string" hint="mongodb:// or mongodb+srv:// URI" checked={!!c.useUri} onChange={(v) => set({ useUri: v })} />
          {c.useUri ? (
            <>
              <Field label="Connection string" span={12} htmlFor="uri" hint="Stored in the OS keychain via VS Code SecretStorage.">
                <Textarea
                  id="uri"
                  rows={3}
                  spellCheck={false}
                  value={c.uri ?? ''}
                  placeholder="mongodb+srv://user:pass@cluster.example.net/mydb?retryWrites=true"
                  className="font-mono text-xs"
                  onChange={(e) => set({ uri: e.target.value })}
                />
              </Field>
              <Field label="Default database" span={6} htmlFor="database">
                {text('database', 'optional')}
              </Field>
            </>
          ) : (
            <>
              <Field label="Host" span={8} htmlFor="host">
                {text('host', '127.0.0.1')}
              </Field>
              <Field label="Port" span={4} htmlFor="port">
                {text('port', portPh, 'number')}
              </Field>
              <Field label="Username" span={4} htmlFor="user">
                {text('user', 'optional')}
              </Field>
              <Field label="Password" span={4} htmlFor="password">
                {password('password', c.password, (v) => set({ password: v }))}
              </Field>
              <Field label="Auth database" span={4} htmlFor="authSource">
                {text('authSource', 'admin')}
              </Field>
              <Field label="Default database" span={6} htmlFor="database">
                {text('database', 'optional')}
              </Field>
            </>
          )}
        </>
      );
    }
    const hostPort = (
      <>
        <Field label="Host" span={8} htmlFor="host">
          {text('host', '127.0.0.1')}
        </Field>
        <Field label="Port" span={4} htmlFor="port">
          {text('port', portPh, 'number')}
        </Field>
      </>
    );
    if (t === 'elasticsearch' && c.kibanaUrl) {
      return (
        <Field label="Kibana" span={12} hint="Sign-in is in Options below. DBDeck reaches Elasticsearch through Kibana, or directly on Elastic Cloud.">
          <span className="font-mono text-xs">{c.kibanaUrl}</span>
        </Field>
      );
    }
    if (t === 'elasticsearch') {
      return (
        <>
          {hostPort}
          <Field label="Username" span={4} htmlFor="user">
            {text('user', 'elastic')}
          </Field>
          <Field label="Password" span={4} htmlFor="password">
            {password('password', c.password, (v) => set({ password: v }))}
          </Field>
          <Field label="API key" span={4} htmlFor="apiKey" hint="Used instead of username/password.">
            {password('apiKey', c.apiKey, (v) => set({ apiKey: v }), 'base64 id:key')}
          </Field>
        </>
      );
    }
    if (t === 'redis') {
      return (
        <>
          {urlField(t)}
          {hostPort}
          <Field label="Username" span={4} htmlFor="user">
            {text('user', 'default (ACL)')}
          </Field>
          <Field label="Password" span={4} htmlFor="password">
            {password('password', c.password, (v) => set({ password: v }))}
          </Field>
          <Field label="Database index" span={4} htmlFor="database">
            {text('database', '0')}
          </Field>
        </>
      );
    }
    return (
      <>
        {URL_TYPES.has(t) && urlField(t)}
        {hostPort}
        <Field label="Username" span={4} htmlFor="user">
          {text('user', DEFAULT_USER[t] ?? '')}
        </Field>
        <Field label="Password" span={4} htmlFor="password">
          {password('password', c.password, (v) => set({ password: v }))}
        </Field>
        <Field label="Database" span={4} htmlFor="database" hint={t === 'postgres' ? 'All databases are listed; this one is opened first.' : undefined}>
          {text('database', t === 'postgres' ? 'postgres' : 'optional')}
        </Field>
      </>
    );
  };

  const isDocker = c.type === 'docker';
  const isS3 = c.type === 's3';
  const isCloud = c.type === 'bigquery' || c.type === 'snowflake';
  const isFile = c.type === 'sqlite';
  const isKibana = c.type === 'elasticsearch' && !!c.kibanaUrl;
  const showSsh = !isS3 && !isCloud && !isFile && !isKibana && !(isDocker && c.useSocket !== false);
  const showSsl = !isS3 && !isCloud && !isFile && !isKibana && (!isDocker || c.useSocket === false);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[820px] flex-col gap-4 px-6 pt-6 pb-10">
          <h1 className="m-0 flex items-center gap-2.5 text-xl font-semibold">
            <img src={I.icons[c.type]} alt="" className="size-[26px]" />
            {isNew ? `New ${meta.label} connection` : `Edit ${c.name || meta.label}`}
          </h1>

          {isNew && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
              {TYPES.map((x) => (
                <button
                  key={x.type}
                  type="button"
                  title={x.hint}
                  onClick={() => pickType(x.type)}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-lg border bg-card px-2 pt-3.5 pb-3 text-xs transition outline-none hover:-translate-y-px hover:border-input focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    x.type === c.type && 'border-ring bg-primary/15 ring-1 ring-ring hover:border-ring',
                  )}
                >
                  <img src={I.icons[x.type]} alt="" className="size-7" />
                  {x.label}
                </button>
              ))}
            </div>
          )}

          <Section icon={<Settings />} title="General">
            <Field label="Name" span={8} htmlFor="name">
              {text('name', `My ${meta.label}`)}
            </Field>
            <Field label="Group" span={4} htmlFor="group">
              <Input
                id="group"
                list="groups"
                value={c.group ?? ''}
                placeholder="e.g. Production"
                autoComplete="off"
                className="h-8"
                onChange={(e) => set({ group: e.target.value })}
              />
              <datalist id="groups">
                {I.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </Section>

          <Section icon={<Server />} title={isDocker ? 'Docker engine' : isS3 ? 'Storage' : isFile ? 'Database' : 'Server'}>
            {serverFields()}
            {!isDocker && !isFile && c.type !== 'bigquery' && !c.googleAuth && (
              <Toggle
                id="savePassword"
                label={isS3 ? 'Remember secret key' : c.type === 'snowflake' ? (c.authMethod === 'keyPair' ? 'Remember passphrase' : 'Remember token') : 'Remember password'}
                hint="On: OS keychain. Off: asked on connect, kept in memory only."
                checked={c.savePassword !== false}
                onChange={(v) => set({ savePassword: v })}
              />
            )}
          </Section>

          {showSsh && (
            <Section title="SSH tunnel" open={sshOpen} onOpenChange={setSshOpen} badge={ssh.enabled ? 'on' : undefined}>
              <Toggle
                id="ssh-enabled"
                label="Connect through an SSH tunnel"
                hint="Traffic is forwarded through a bastion host"
                checked={ssh.enabled}
                onChange={(v) => setSsh({ enabled: v })}
              />
              {ssh.enabled && (
                <>
                  <Field label="SSH host" span={8} htmlFor="ssh-host">
                    {sshText('host', 'bastion.example.com')}
                  </Field>
                  <Field label="SSH port" span={4} htmlFor="ssh-port">
                    {sshText('port', '22', 'number')}
                  </Field>
                  <Field label="SSH user" span={4} htmlFor="ssh-username">
                    {sshText('username', 'ubuntu')}
                  </Field>
                  <Field label="Authentication" span={4}>
                    <Select value={ssh.authType} onValueChange={(v) => setSsh({ authType: v as Ssh['authType'] })}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="password">Password</SelectItem>
                        <SelectItem value="key">Private key</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {ssh.authType === 'password' ? (
                    <Field label="SSH password" span={4} htmlFor="ssh-password">
                      {password('ssh-password', ssh.password, (v) => setSsh({ password: v }))}
                    </Field>
                  ) : (
                    <>
                      <Field label="Private key" span={8} htmlFor="ssh-privateKeyPath">
                        <div className="flex gap-1.5">
                          {sshText('privateKeyPath', '~/.ssh/id_ed25519')}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            title="Browse"
                            onClick={async () => {
                              const p = await rpc<string | undefined>('pickKey');
                              if (p) setSsh({ privateKeyPath: p });
                            }}
                          >
                            <FolderOpen />
                          </Button>
                        </div>
                      </Field>
                      <Field label="Passphrase" span={4} htmlFor="ssh-passphrase">
                        {password('ssh-passphrase', ssh.passphrase, (v) => setSsh({ passphrase: v }), 'optional')}
                      </Field>
                    </>
                  )}
                </>
              )}
            </Section>
          )}

          <Section title="Options" open={optionsOpen} onOpenChange={setOptionsOpen}>
            {isS3 && googleOptions()}
            {c.type === 'bigquery' && bigQueryGoogle()}
            {c.type === 'elasticsearch' && kibanaOptions()}
            {showSsl && <Toggle id="ssl" label="Use SSL / TLS" hint="Encrypt the connection" checked={!!c.ssl} onChange={(v) => set({ ssl: v })} />}
            {(showSsl || (isS3 && !c.googleAuth) || isKibana) && (
              <Toggle
                id="rejectUnauthorized"
                label="Verify server certificate"
                hint={showSsl && !c.ssl ? 'Turn on SSL / TLS first' : 'Turn off for self-signed certificates'}
                checked={!!c.rejectUnauthorized && (!showSsl || !!c.ssl)}
                disabled={showSsl && !c.ssl}
                onChange={(v) => set({ rejectUnauthorized: v })}
              />
            )}
            {!isDocker && !isS3 && (
              <Toggle
                id="showSystem"
                label="Show system objects"
                hint="System databases, schemas, empty Redis DBs"
                checked={!!c.showSystem}
                onChange={(v) => set({ showSystem: v })}
              />
            )}
            {!isDocker && (
              <Toggle
                id="readonly"
                label="Read-only"
                hint={isS3 ? 'Block uploads and deletes' : 'Block writes from the data viewer and editors'}
                checked={!!c.readonly}
                onChange={(v) => set({ readonly: v })}
              />
            )}
          </Section>
        </div>
      </div>

      <div className="flex items-center gap-2.5 border-t bg-background/90 px-6 py-3 backdrop-blur">
        <div
          className={cn(
            'mr-auto flex min-w-0 items-center gap-1.5 text-xs [&>svg]:size-3.5 [&>svg]:shrink-0',
            status?.kind === 'ok' && 'text-success',
            status?.kind === 'err' && 'text-destructive',
          )}
        >
          {status?.kind === 'busy' && <Loader2 className="animate-spin" />}
          {status?.kind === 'ok' && <CircleCheck />}
          {status?.kind === 'err' && <CircleAlert />}
          {status && (
            <span className="truncate" title={status.text}>
              {status.text}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={test} disabled={status?.kind === 'busy'}>
          <Plug />
          Test connection
        </Button>
        <Button variant="outline" size="sm" onClick={() => rpc('cancel')}>
          <X />
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          <Check />
          Save
        </Button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
