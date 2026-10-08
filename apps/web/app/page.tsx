import { ArrowRight, Download } from "lucide-react";
import { AiFigure, ChatFigure, PrivacyFigure, RedisFigure, SchemaFigure, SqlFigure } from "@/components/site/animated-figures";
import { CopyCommand } from "@/components/site/copy-command";
import { Faq } from "@/components/site/faq";
import { NavLinks } from "@/components/site/nav-links";
import { SectionLink } from "@/components/site/section-link";
import { Organize } from "@/components/site/organize";
import { ProductDemo } from "@/components/site/product-demo";
import {
  Caption,
  GhostCta,
  GitHubIcon,
  Heading,
  Kbd,
  Lede,
  Pin,
  PrimaryCta,
  Shell,
  SoftDivider,
  links,
} from "@/components/site/primitives";

const services = [
  { icon: "postgres", name: "PostgreSQL" },
  { icon: "sqlite", name: "SQLite" },
  { icon: "mysql", name: "MySQL / MariaDB" },
  { icon: "redis", name: "Redis" },
  { icon: "mssql", name: "Microsoft SQL Server" },
  { icon: "mongodb", name: "MongoDB" },
  { icon: "elasticsearch", name: "Elasticsearch" },
  { icon: "oracle", name: "Oracle" },
  { icon: "dynamodb", name: "DynamoDB" },
  { icon: "bigquery", name: "BigQuery" },
  { icon: "snowflake", name: "Snowflake" },
  { icon: "clickhouse", name: "ClickHouse" },
  { icon: "cassandra", name: "Cassandra" },
  { icon: "d1", name: "Cloudflare D1" },
  { icon: "s3", name: "S3 / MinIO / R2" },
  { icon: "docker", name: "Docker" },
];

const storage = [
  ["Connection settings", "Editor global state", "this machine"],
  ["Passwords and keys", "OS keychain (SecretStorage)", "encrypted"],
  ["Remember password off", "Session memory", "gone on reload"],
  ["Query results", "Not stored", "Not applicable"],
  ["Telemetry", "None", "Not applicable"],
];

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <Shell className="flex h-14 items-center justify-between">
        <SectionLink href="#top" className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={24} height={24} className="size-6" />
          DBDeck
        </SectionLink>
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <NavLinks />
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
    <section id="top" className="pt-36 pb-16 lg:pt-44">
      <Shell className="flex flex-col items-center text-center">
        <h1 className="font-heading text-5xl leading-[0.98] font-semibold tracking-tight text-balance motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 md:text-7xl lg:text-[80px]">
          Your databases.
          <br />
          <span className="text-muted-foreground">Inside your editor.</span>
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-[1.75] text-muted-foreground">
          A free, open source database client for VS Code and Cursor.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <PrimaryCta href="#install">
            Install DBDeck
            <ArrowRight className="size-4" />
          </PrimaryCta>
          <GhostCta href={links.github}>
            <GitHubIcon className="size-4" />
            Read the source
          </GhostCta>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          <span>Free forever</span>
          <Pin />
          <span>MIT licensed</span>
          <Pin />
          <span>Nothing leaves your machine</span>
        </div>
      </Shell>
    </section>
  );
}

function Overview() {
  return (
    <section className="pt-12">
      <Shell>
        <ProductDemo />
      </Shell>
    </section>
  );
}

function Services() {
  return (
    <section id="features" aria-label="Supported services" className="scroll-mt-24 pb-6">
      <Shell className="text-center">
        <h2 className="text-sm text-muted-foreground">All your connections. One place.</h2>
        <ul className="mt-8 grid grid-cols-4 gap-x-3 gap-y-8 sm:grid-cols-6 lg:grid-cols-7">
          {services.map((s, i) => (
            <li key={s.name} className="service-mark group flex flex-col items-center gap-3" style={{ animationDelay: `${i * -0.7}s` }}>
              <span className="relative grid size-16 place-items-center sm:size-20">
                <span aria-hidden className="absolute inset-0 rounded-full bg-brand/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/types/${s.icon}-on.svg`} alt="" width={40} height={40} className="relative size-9 transition-transform duration-500 group-hover:scale-110 sm:size-10" />
              </span>
              <span className="text-[11px] text-muted-foreground transition-colors group-hover:text-foreground sm:text-xs">{s.name}</span>
            </li>
          ))}
        </ul>
      </Shell>
      <Shell><p className="mt-6 text-center text-sm leading-relaxed text-muted-foreground">SQL Server includes schema browsing, transactional row editing and foreign key diagrams. DynamoDB includes item browsing and PartiQL queries with AWS credentials. Cassandra includes keyspaces, native paging and CQL queries. DynamoDB and Cassandra use the query editor for changes; full-text table search is unavailable.</p></Shell>
    </section>
  );
}

function Sql() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Write SQL" rest="where you write code." />
            <Lede>Write a query. Press <Kbd>⌘ Enter</Kbd>. See your results. Browse wide tables with smooth scrolling.</Lede>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">Looking for a value? Open Omnisearch beside a database or schema. Type JUREK and find players: Jurek (name), then open the matching records. Works with PostgreSQL, MySQL / MariaDB, SQLite, Cloudflare D1, Oracle, MSSQL, ClickHouse, BigQuery, Snowflake and MongoDB.</p>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <SqlFigure code={"SELECT name, total\nFROM orders\nWHERE status = 'paid';"} />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Schema() {
  const tables = [
    { name: "customers", columns: [["id", "PK"], ["name", "text"], ["email", "text"]] },
    { name: "orders", columns: [["id", "PK"], ["customer_id", "FK"], ["total", "decimal"]] },
  ];
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="order-2 min-w-0 lg:order-1 lg:col-span-7">
            <SchemaFigure tables={tables} link={{ from: "orders.customer_id", to: "customers.id" }} />
          </div>
          <div className="order-1 lg:order-2 lg:col-span-5">
            <Heading lead="The schema," rest="drawn for you." />
            <Lede>See your tables and how they connect. Foreign keys are linked for PostgreSQL, MySQL, SQLite, Cloudflare D1, Oracle and MSSQL.</Lede>
          </div>
        </div>
      </Shell>
    </section>
  );
}

function NoSql() {
  const fields = [["name", "Anna Kowalska"], ["email", "anna@example.com"], ["country", "PL"], ["plan", "pro"]];
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Beyond SQL." rest="Edit keys and documents." />
            <Lede>Browse and edit Redis, MongoDB and Elasticsearch right in your editor.</Lede>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <RedisFigure fields={fields} edit={["plan", "team"]} />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Ai() {
  return (
    <section aria-label="AI integration">
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Your words." rest="Ready-to-run SQL." />
            <Lede>Describe what you need. AI uses your schema to write a query you can review and run.</Lede>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Connect ChatGPT, an OpenAI or Claude API key, or local Ollama.</p>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <AiFigure prompt="Show my five biggest orders" sql={"SELECT name, total\nFROM orders\nORDER BY total DESC\nLIMIT 5;"} />
          </div>
        </div>
      </Shell>
    </section>
  );
}

function Chat() {
  return (
    <section aria-label="Chat with your database">
      <Shell>
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="order-2 min-w-0 lg:order-1 lg:col-span-7">
            <ChatFigure
              question="Who were our best customers last month?"
              steps={[{ label: "Read the columns of orders and customers" }, { label: "Ran a read-only query", query: true }]}
              rows={[
                ["Anna Kowalska", "412.00"],
                ["Piotr Zieliński", "248.40"],
                ["Jan Nowak", "186.50"],
              ]}
              answer="Anna Kowalska leads with 412.00 across 3 orders, ahead of Piotr Zieliński and Jan Nowak."
            />
          </div>
          <div className="order-1 lg:order-2 lg:col-span-5">
            <Heading lead="Ask your database." rest="Get answers, not just SQL." />
            <Lede>Chat with any SQL connection. The assistant reads the schema, runs read-only queries when you allow it and answers from the results.</Lede>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Every query it suggests opens in your editor or runs read-only in the chat. Writes never run on their own.</p>
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
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Heading lead="Your credentials" rest="never leave your machine." />
            <Lede>Your passwords stay in your OS keychain. No telemetry, analytics or cloud sync.</Lede>
          </div>
          <div className="lg:col-span-7">
            <PrivacyFigure rows={storage} note="No telemetry, analytics or cloud sync. Read the code to check." />
            <Caption>Fig. 08: the full list</Caption>
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
          <CopyCommand editor="VS Code" icon="/editors/vscode.svg" command="code --install-extension dbdeck.dbdeck" />
          <CopyCommand editor="Cursor" icon="/editors/cursor.svg" command="cursor --install-extension dbdeck.dbdeck" />
          <CopyCommand editor="VSCodium" icon="/editors/vscodium.svg" command="codium --install-extension dbdeck.dbdeck" />
          <CopyCommand editor="Windsurf" icon="/editors/windsurf.svg" command="windsurf --install-extension dbdeck.dbdeck" />
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
          <a href={links.support} className="transition-colors hover:text-foreground">
            Support DBDeck
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
        <Organize />
        <SoftDivider />
        <Sql />
        <SoftDivider />
        <Schema />
        <SoftDivider />
        <NoSql />
        <SoftDivider />
        <Ai />
        <SoftDivider />
        <Chat />
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
