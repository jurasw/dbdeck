import { ArrowRight, Download } from "lucide-react";
import { CopyCommand } from "@/components/site/copy-command";
import { Faq } from "@/components/site/faq";
import { HeroGrid } from "@/components/site/hero-grid";
import {
  Caption,
  Frame,
  FrameChrome,
  GhostCta,
  GitHubIcon,
  Heading,
  Kbd,
  Lede,
  Pin,
  PrimaryCta,
  Screenshot,
  Shell,
  SmallList,
  SoftDivider,
  links,
} from "@/components/site/primitives";

const services = [
  { icon: "postgres", name: "PostgreSQL", tools: "SQL, grid editing, DDL, diagrams" },
  { icon: "mysql", name: "MySQL / MariaDB", tools: "SQL, grid editing, DDL, diagrams" },
  { icon: "clickhouse", name: "ClickHouse", tools: "SQL editor, data browsing, DDL" },
  { icon: "mongodb", name: "MongoDB", tools: "Documents, filters, aggregation" },
  { icon: "redis", name: "Redis", tools: "Key tree, value editors, TTL, CLI" },
  { icon: "elasticsearch", name: "Elasticsearch", tools: "Indices, documents, console" },
  { icon: "s3", name: "S3 / MinIO / R2", tools: "Buckets, uploads, downloads" },
  { icon: "docker", name: "Docker", tools: "Containers, logs, shell, discovery" },
];

const storage = [
  ["Connection settings", "Editor global state", "this machine"],
  ["Passwords and keys", "OS keychain (SecretStorage)", "encrypted"],
  ["Remember password off", "Session memory", "gone on reload"],
  ["Query results", "Not stored", "—"],
  ["Telemetry", "None", "—"],
];

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <Shell className="flex h-14 items-center justify-between">
        <a href="#top" className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={24} height={24} className="size-6" />
          DBDeck
        </a>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <a href="#features" className="hidden rounded-full px-3 py-1.5 transition-colors hover:text-foreground sm:inline">
            Features
          </a>
          <a href="#install" className="hidden rounded-full px-3 py-1.5 transition-colors hover:text-foreground sm:inline">
            Install
          </a>
          <a href="#faq" className="hidden rounded-full px-3 py-1.5 transition-colors hover:text-foreground sm:inline">
            FAQ
          </a>
          <a
            href={links.github}
            className="ml-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-card"
          >
            <GitHubIcon className="size-4" />
            GitHub
          </a>
        </nav>
      </Shell>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="pt-36 pb-12 lg:pt-44">
      <Shell>
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7">
            <h1 className="font-heading text-5xl leading-[0.98] font-semibold tracking-tight motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 md:text-7xl lg:text-[80px]">
              Your databases.
              <br />
              Inside your
              <br />
              <span className="text-muted-foreground">editor.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-[1.75] text-muted-foreground">
              DBDeck is a free, open source database client for VS Code and Cursor. Browse tables, run queries and edit
              rows next to your code. No account, no paywall, no telemetry.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <PrimaryCta href="#install">
                Install DBDeck
                <ArrowRight className="size-4" />
              </PrimaryCta>
              <GhostCta href={links.github}>
                <GitHubIcon className="size-4" />
                Read the source
              </GhostCta>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
              <span>Free forever</span>
              <Pin />
              <span>MIT licensed</span>
              <Pin />
              <span>Nothing leaves your machine</span>
            </div>
          </div>
          <div className="lg:col-span-5">
            <HeroGrid />
            <Caption>Fig. 01 — the data grid, mid-shift</Caption>
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Overview() {
  return (
    <section className="pt-12">
      <Shell>
        <Screenshot
          src="/screenshots/data-grid.png"
          alt="DBDeck in VS Code: connection tree with PostgreSQL, Redis and MongoDB, and the customers table in the data grid"
          chrome="vs code · dbdeck"
          caption="Fig. 02 — connections on the left, a 240-row table on the right"
        />
      </Shell>
    </section>
  );
}

function Services() {
  return (
    <section id="features" className="scroll-mt-24">
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Eight services." rest="One sidebar." />
            <Lede>
              Keep every connection in one tree, grouped the way you work. SSH tunnels, SSL and read-only mode come with
              each of them.
            </Lede>
            <SmallList
              items={[
                "SSH tunnels with password or private key",
                "Read-only connections block every write",
                "Docker containers become connections in one click",
              ]}
            />
          </div>
          <div className="lg:col-span-7">
            <Frame>
              <FrameChrome left="add connection" right={<span>8 types</span>} />
              <ul className="grid grid-cols-1 sm:grid-cols-2">
                {services.map((s) => (
                  <li
                    key={s.name}
                    className="flex items-center gap-3.5 border-b border-border/60 px-5 py-4 transition-colors hover:bg-white/[0.03] sm:odd:border-r"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-black/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/types/${s.icon}-on.svg`} alt="" width={18} height={18} className="size-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-foreground">{s.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.tools}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Frame>
            <Caption>Fig. 03 — every type DBDeck connects to</Caption>
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Sql() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <Heading lead="Write SQL" rest="where you write code." />
            <Lede>
              Put the cursor in a statement and press <Kbd>⌘ Enter</Kbd>. Each statement gets its own result tab, with a row
              filter, JSON view and CSV or JSON export.
            </Lede>
            <SmallList
              items={[
                "Table and column completion with aliases",
                "Run one statement or the whole file",
                "Inline edits saved in one transaction",
              ]}
            />
          </div>
          <div className="lg:col-span-8">
            <Screenshot
              src="/screenshots/sql-editor.png"
              alt="SQL editor with a join query and the Query Results panel listing revenue per customer"
              chrome="query · shop · postgres"
              caption="Fig. 04 — 12 rows in 59 ms"
            />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Schema() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-8 lg:order-1 order-2">
            <Screenshot
              src="/screenshots/schema-diagram.png"
              alt="Schema diagram of seven tables with primary keys, foreign keys and relationship lines"
              chrome="public · diagram"
              caption="Fig. 05 — 7 tables, 7 foreign key links"
            />
          </div>
          <div className="order-1 lg:order-2 lg:col-span-4">
            <Heading lead="The schema," rest="drawn for you." />
            <Lede>
              Open any PostgreSQL or MySQL schema as a diagram. Foreign keys link column to column. Drag tables, pan,
              zoom and search; the layout is remembered.
            </Lede>
            <SmallList items={["Primary and foreign keys marked", "Arrange and Fit in one click", "ClickHouse tables too"]} />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function NoSql() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <Heading lead="Not only SQL." rest="Real editors for keys and documents." />
            <Lede>
              Redis keys grouped by separator with editors for every type. MongoDB documents with filters and
              shell-style scripts. Elasticsearch with a Kibana-style console.
            </Lede>
            <SmallList
              items={[
                "Hash, list, set, zset, stream, RedisJSON",
                "db.users.find({...}).sort(...) just works",
                "S3 buckets: open, upload, copy s3:// URI",
              ]}
            />
          </div>
          <div className="lg:col-span-8">
            <Screenshot
              src="/screenshots/redis.png"
              alt="Redis key tree grouped by prefix and the hash editor for user:42"
              chrome="user:42 · cache · redis"
              caption="Fig. 06 — a hash, four fields, no expiry"
            />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Privacy() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Your credentials" rest="never leave your machine." />
            <Lede>
              DBDeck talks to the databases you add and to nothing else. There is no backend to sign in to, so there is no
              backend to leak.
            </Lede>
            <SmallList
              items={[
                "AI queries share table names, never rows",
                "Bring ChatGPT, Claude, your own API key or Ollama",
                "AI agents read through MCP, read-only",
                "Destructive actions always ask first",
              ]}
            />
          </div>
          <div className="lg:col-span-7">
            <Frame>
              <FrameChrome left="what dbdeck keeps" right={<span className="text-brand">local only</span>} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] table-fixed text-left font-mono text-[12px]">
                  <thead className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 font-medium">data</th>
                      <th className="px-4 py-2.5 font-medium">lives in</th>
                      <th className="w-32 px-4 py-2.5 font-medium">note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storage.map(([data, where, note]) => (
                      <tr key={data} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 text-foreground/90">{data}</td>
                        <td className="px-4 py-3 text-muted-foreground">{where}</td>
                        <td className="px-4 py-3 text-brand">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border bg-black/20 px-4 py-2 font-mono text-[11px] text-muted-foreground/80 italic">
                No telemetry, analytics or cloud sync. Read the code to check.
              </div>
            </Frame>
            <Caption>Fig. 07 — the full list</Caption>
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Install() {
  const options = [
    {
      title: "VS Code",
      body: "Open Extensions, search for DBDeck and click Install.",
      href: links.marketplace,
      cta: "Visual Studio Marketplace",
    },
    {
      title: "Cursor, VSCodium, Windsurf",
      body: "Same search in the Extensions view. These editors install from Open VSX.",
      href: links.openVsx,
      cta: "Open VSX Registry",
    },
    {
      title: "Manual install",
      body: "Download the VSIX from GitHub Releases and choose Install from VSIX.",
      href: links.releases,
      cta: "GitHub Releases",
    },
  ];
  return (
    <section id="install" className="scroll-mt-24">
      <Shell>
        <Heading lead="Install in a minute." rest="Pick your editor." />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {options.map((o) => (
            <a
              key={o.title}
              href={o.href}
              className="group flex flex-col rounded-2xl border border-border bg-card/40 p-6 transition-colors hover:border-brand/50 hover:bg-card/70"
            >
              <span className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase">{o.cta}</span>
              <span className="mt-4 text-lg font-semibold text-foreground">{o.title}</span>
              <span className="mt-2 text-[15px] leading-[1.7] text-muted-foreground">{o.body}</span>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm text-brand">
                Open
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </a>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <CopyCommand command="code --install-extension dbdeck.dbdeck" />
          <CopyCommand command="cursor --install-extension dbdeck.dbdeck" />
        </div>
      </Shell>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-24">
      <Shell className="max-w-3xl">
        <Heading lead="Questions," rest="answered." />
        <Faq />
      </Shell>
    </section>
  );
}

function Coda() {
  return (
    <section className="py-28">
      <Shell>
        <h2 className="max-w-3xl font-heading text-3xl leading-[1.05] font-semibold tracking-tight text-balance md:text-5xl">
          Free. No account. <span className="text-muted-foreground">No paywall, ever.</span>
        </h2>
        <p className="mt-6 max-w-xl text-lg leading-[1.7] text-muted-foreground">
          Install it, add a connection, open a table. You are querying in under a minute.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <PrimaryCta href="#install">
            Install DBDeck
            <ArrowRight className="size-4" />
          </PrimaryCta>
          <GhostCta href={links.releases}>
            <Download className="size-4" />
            Download VSIX
          </GhostCta>
        </div>
      </Shell>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 py-10">
      <Shell className="flex flex-col gap-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={20} height={20} className="size-5" />
          DBDeck · MIT License
        </span>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={links.github} className="transition-colors hover:text-foreground">
            GitHub
          </a>
          <a href={links.changelog} className="transition-colors hover:text-foreground">
            Changelog
          </a>
          <a href={links.issues} className="transition-colors hover:text-foreground">
            Report a bug
          </a>
        </nav>
      </Shell>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 40rem at 15% -10%, rgba(91,140,255,0.10), transparent 60%), radial-gradient(40rem 30rem at 90% 15%, rgba(255,255,255,0.03), transparent 60%)",
        }}
      />
      <Nav />
      <main>
        <Hero />
        <Overview />
        <SoftDivider />
        <Services />
        <SoftDivider />
        <Sql />
        <SoftDivider />
        <Schema />
        <SoftDivider />
        <NoSql />
        <SoftDivider />
        <Privacy />
        <SoftDivider />
        <Install />
        <SoftDivider />
        <FaqSection />
        <Coda />
      </main>
      <Footer />
    </div>
  );
}
