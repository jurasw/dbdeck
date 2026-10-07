"use client";

import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  Database,
  Folder,
  Loader2,
  Lock,
  Network,
  Plus,
  Search,
  Settings,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { between, Caret, typed, useInView, useReducedMotion } from "./motion";
import { Caption, Frame, FrameChrome } from "./primitives";
import { SqlCode } from "./sql-code";

const scenes = [
  { id: "browse", label: "Browse", hint: "groups and tables", dur: 4200 },
  { id: "search", label: "Search", hint: "find any object", dur: 4600 },
  { id: "filter", label: "AI filter", hint: "plain words to WHERE", dur: 7600 },
  { id: "query", label: "AI query", hint: "describe, get SQL", dur: 9200 },
  { id: "diagram", label: "Diagram", hint: "tables and relations", dur: 8400 },
] as const;

type SceneId = (typeof scenes)[number]["id"];

const orders = [
  ["1201", "Anna Kowalska", "PL", "paid", "412.00", "10-05 18:22"],
  ["1200", "Mia Novak", "CZ", "shipped", "74.90", "10-05 17:51"],
  ["1199", "Jan Nowak", "PL", "paid", "186.50", "10-05 16:03"],
  ["1198", "Oliver Berg", "SE", "delivered", "311.90", "10-05 14:40"],
  ["1197", "Zofia Wójcik", "PL", "pending", "129.00", "10-05 12:17"],
  ["1196", "Lucas Silva", "PT", "paid", "126.90", "10-05 11:09"],
  ["1195", "Piotr Zieliński", "PL", "paid", "248.40", "10-05 09:55"],
  ["1194", "Emma Dubois", "FR", "refunded", "48.90", "10-04 22:31"],
  ["1193", "Ava Jensen", "DK", "paid", "89.90", "10-04 20:12"],
  ["1192", "Kasia Lewandowska", "PL", "paid", "64.00", "10-04 19:48"],
  ["1191", "Zoe Kim", "KR", "delivered", "205.90", "10-04 18:30"],
];

const matches = (r: string[]) => r[3] === "paid" && r[2] === "PL" && Number(r[4]) > 100;

const statusTone: Record<string, string> = {
  paid: "text-brand",
  shipped: "text-sky-300",
  delivered: "text-emerald-300",
  refunded: "text-rose-300",
  pending: "text-amber-300",
};

const prompt = "paid orders from Poland over 100";
const generatedWhere = "status = 'paid' AND country = 'PL' AND total > 100";

const aiPrompt = "Top 5 customers by revenue this month";
const aiSql = `SELECT c.full_name, SUM(o.total) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.placed_at >= date_trunc('month', now())
GROUP BY c.full_name
ORDER BY revenue DESC
LIMIT 5;`;

const revenue = [
  ["Anna Kowalska", "1,842.40"],
  ["Oliver Berg", "1,311.90"],
  ["Mia Novak", "1,206.00"],
  ["Jan Nowak", "986.50"],
  ["Ava Jensen", "911.90"],
];

export const searchItems = [
  ["categories", "table", "Tables · shop › public"],
  ["customers", "table", "Tables · shop › public"],
  ["orders", "table", "Tables · shop › public"],
  ["order_items", "table", "Tables · shop › public"],
  ["payments", "table", "Tables · shop › public"],
  ["products", "table", "Tables · shop › public"],
  ["shipments", "table", "Tables · shop › public"],
  ["order_totals", "view", "Views · shop › public"],
  ["refund_order", "function", "Functions · shop › public"],
];

type TreeRow = {
  id: string;
  depth: number;
  label: string;
  meta?: string;
  kind: "group" | "conn" | "db" | "schema" | "table";
  icon?: string;
  open?: boolean;
  lock?: boolean;
};

const tree: TreeRow[] = [
  { id: "g-local", depth: 0, label: "Local", kind: "group", open: true },
  { id: "c-shop", depth: 1, label: "Shop · Postgres", kind: "conn", icon: "postgres", open: true },
  { id: "d-shop", depth: 2, label: "shop", kind: "db", open: true },
  { id: "public", depth: 3, label: "public", kind: "schema", open: true },
  { id: "customers", depth: 4, label: "customers", meta: "~240", kind: "table" },
  { id: "orders", depth: 4, label: "orders", meta: "~1.2k", kind: "table" },
  { id: "order_items", depth: 4, label: "order_items", meta: "~3.4k", kind: "table" },
  { id: "payments", depth: 4, label: "payments", meta: "~960", kind: "table" },
  { id: "products", depth: 4, label: "products", kind: "table" },
  { id: "shipments", depth: 4, label: "shipments", meta: "~480", kind: "table" },
  { id: "c-cache", depth: 1, label: "Cache · Redis", kind: "conn", icon: "redis" },
  { id: "g-staging", depth: 0, label: "Staging", kind: "group", open: true },
  { id: "c-events", depth: 1, label: "Events · MongoDB", kind: "conn", icon: "mongodb" },
  { id: "c-logs", depth: 1, label: "Logs · Elasticsearch", kind: "conn", icon: "elasticsearch" },
  { id: "g-prod", depth: 0, label: "Production", kind: "group", open: true },
  { id: "c-prod", depth: 1, label: "Shop · Postgres", kind: "conn", icon: "postgres", lock: true },
  { id: "c-assets", depth: 1, label: "Assets · S3", kind: "conn", icon: "s3", lock: true },
];

function Sidebar({ active, sparkle }: { active: string; sparkle?: boolean }) {
  return (
    <aside className="hidden w-[214px] shrink-0 flex-col border-r border-border bg-black/25 md:flex">
      <div className="flex h-8 items-center justify-between px-3 font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
        <span>Connections</span>
        <span className="flex items-center gap-1.5 text-muted-foreground/80">
          <Search className="size-3" />
          <Plus className="size-3" />
        </span>
      </div>
      <ul className="flex-1 overflow-hidden pb-2 text-[11.5px]">
        {tree.map((r) => {
          const on = r.id === active;
          return (
            <li
              key={r.id}
              className={cn(
                "flex h-[22px] items-center gap-1.5 pr-2 transition-colors duration-300",
                on ? "bg-brand/20 text-foreground shadow-[inset_2px_0_0_var(--brand)]" : "text-foreground/75",
              )}
              style={{ paddingLeft: 8 + r.depth * 11 }}
            >
              {r.kind === "table" ? (
                <span className="w-3" />
              ) : r.open ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              {r.kind === "group" && <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
              {r.kind === "conn" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/types/${r.icon}-on.svg`} alt="" width={13} height={13} className="size-[13px] shrink-0" />
              )}
              {r.kind === "db" && <Database className="size-3.5 shrink-0 text-muted-foreground" />}
              {r.kind === "schema" && <Braces className="size-3.5 shrink-0 text-muted-foreground" />}
              {r.kind === "table" && <Table2 className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn("truncate", r.kind === "group" && "font-medium text-foreground")}>{r.label}</span>
              {r.meta && <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70">{r.meta}</span>}
              {r.lock && <Lock className="ml-auto size-3 shrink-0 text-amber-300/80" />}
              {r.id === "public" && sparkle && (
                <Sparkles className="ml-auto size-3 shrink-0 text-brand motion-safe:animate-pulse" />
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function EditorTabs({ scene }: { scene: SceneId }) {
  const tabs = [
    { id: "orders", label: "orders", icon: Table2, show: true },
    { id: "ai", label: "AI Query", icon: Sparkles, show: scene === "query" || scene === "diagram" },
    { id: "diagram", label: "public · Diagram", icon: Network, show: scene === "diagram" },
  ];
  const active = scene === "query" ? "ai" : scene === "diagram" ? "diagram" : "orders";
  return (
    <div className="flex h-8 shrink-0 items-end border-b border-border bg-black/20 text-[11px]">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <span
            key={t.id}
            className={cn(
              "flex h-full items-center gap-1.5 border-r border-border px-3 motion-safe:animate-in motion-safe:fade-in",
              t.id === active ? "bg-card/70 text-foreground shadow-[inset_0_1px_0_var(--brand)]" : "text-muted-foreground",
            )}
          >
            <t.icon className={cn("size-3", t.id === "ai" && "text-brand")} />
            {t.label}
          </span>
        ))}
    </div>
  );
}

function Btn({
  children,
  pressed,
  primary,
  className,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[10.5px] transition-all duration-200",
        primary ? "border-transparent bg-white font-medium text-black" : "border-border bg-white/[0.03] text-foreground/80",
        pressed && "scale-90 ring-2 ring-brand ring-offset-1 ring-offset-transparent",
        className,
      )}
    >
      {children}
    </span>
  );
}

function OrdersGrid({ t, scene }: { t: number; scene: SceneId }) {
  const filter = scene === "filter";
  const typing = filter && between(t, 300, 2700);
  const loading = filter && between(t, 2700, 3900);
  const generated = filter && t >= 3900;
  const filtered = filter && t >= 5100;
  const toast = filter && between(t, 3900, 6600);
  const reveal = scene === "browse" ? t : Infinity;

  let where: React.ReactNode = <span className="text-muted-foreground/60">id &gt; 10 AND status = &apos;active&apos;</span>;
  if (typing || loading)
    where = (
      <span className={cn("font-sans text-[11.5px]", loading ? "text-muted-foreground" : "text-foreground")}>
        {typed(prompt, t, 300, 62)}
        {typing && <Caret />}
      </span>
    );
  if (generated)
    where = (
      <span key="sql" className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-1">
        <SqlCode code={generatedWhere} />
      </span>
    );

  const visible = orders.filter((r) => !filtered || matches(r));

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <span className="grid size-7 place-items-center rounded-md border border-border bg-white/[0.03]">
          <Table2 className="size-3.5 text-muted-foreground" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-medium">orders</span>
          <span className="block truncate text-[10px] text-muted-foreground">Shop · Postgres › shop › public</span>
        </span>
        <span className="ml-auto hidden items-center gap-3 font-mono text-[10px] text-muted-foreground sm:flex">
          <span>DDL</span>
          <span>CSV</span>
          <span>JSON</span>
        </span>
      </div>
      <div className="flex items-center gap-2 px-4 pb-2.5">
        <div
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center rounded-md border bg-black/30 font-mono text-[11px] transition-colors duration-300",
            typing || loading ? "border-brand/70" : "border-border",
            generated && !filtered && "border-brand/50",
          )}
        >
          <span className="flex h-full items-center border-r border-border px-2 text-[9px] tracking-[0.15em] text-muted-foreground">
            WHERE
          </span>
          <span className="min-w-0 flex-1 truncate px-2">{where}</span>
          <span
            className={cn(
              "mr-0.5 grid size-6 shrink-0 place-items-center rounded transition-all duration-200",
              filter && between(t, 2500, 2800) && "scale-90 bg-brand/30 ring-2 ring-brand",
              loading && "bg-brand/15",
            )}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-brand" />
            ) : (
              <Sparkles className={cn("size-3.5", filter ? "text-brand" : "text-muted-foreground")} />
            )}
          </span>
        </div>
        <div className="hidden h-7 w-44 shrink-0 items-center rounded-md border border-border bg-black/30 font-mono text-[11px] lg:flex">
          <span className="flex h-full items-center border-r border-border px-2 text-[9px] tracking-[0.15em] whitespace-nowrap text-muted-foreground">
            ORDER BY
          </span>
          <span className="truncate px-2 text-foreground/80">placed_at DESC</span>
        </div>
        <Btn primary pressed={filter && between(t, 4900, 5150)}>
          Apply
        </Btn>
      </div>
      <div className="flex items-center gap-1.5 border-y border-border px-4 py-1.5">
        <Btn>
          <Plus className="size-3" />
          Add row
        </Btn>
        <Btn className="hidden sm:inline-flex">
          <Copy className="size-3" />
          Duplicate
        </Btn>
        <Btn className="hidden sm:inline-flex">
          <Trash2 className="size-3" />
          Delete
        </Btn>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
          {filtered ? "1–3 of 3 · 6 ms" : "1–100 of 1,200 · 4 ms"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden font-mono text-[11px]">
        <div className="flex h-7 items-center border-b border-border text-[9px] tracking-[0.15em] text-muted-foreground uppercase">
          <span className="w-14 px-4">id</span>
          <span className="flex-1 px-2">customer</span>
          <span className="w-10 px-2">cc</span>
          <span className="w-[74px] px-2">status</span>
          <span className="w-[70px] px-2 text-right">total</span>
          <span className="hidden w-28 px-4 sm:block">placed_at</span>
        </div>
        {visible.map((r, i) => {
          const shown = reveal >= 250 + i * 70;
          const hit = filtered && matches(r);
          return (
            <div
              key={r[0]}
              className={cn(
                "flex h-[25px] items-center border-b border-border/50 transition-all duration-500",
                shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                hit && "bg-brand/[0.08] motion-safe:animate-in motion-safe:fade-in",
                scene === "search" && r[0] === "1201" && t >= 2900 && "bg-brand/10",
              )}
            >
              <span className="w-14 px-4 text-muted-foreground tabular-nums">{r[0]}</span>
              <span className="flex-1 truncate px-2 text-foreground/90">{r[1]}</span>
              <span className="w-10 px-2 text-muted-foreground">{r[2]}</span>
              <span className={cn("w-[74px] px-2", statusTone[r[3]])}>{r[3]}</span>
              <span className="w-[70px] px-2 text-right text-foreground/90 tabular-nums">{r[4]}</span>
              <span className="hidden w-28 px-4 text-muted-foreground tabular-nums sm:block">{r[5]}</span>
            </div>
          );
        })}
      </div>
      {toast && (
        <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-[#12251f]/95 px-3 py-2 text-[11px] text-emerald-100 shadow-xl shadow-black/40 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
          <Check className="size-3.5 text-emerald-300" />
          AI filter ready. Review it and click Apply.
        </div>
      )}
    </div>
  );
}

export function SearchPalette({
  query,
  active = 0,
  typing,
  pressed,
  rows,
  className,
}: {
  query: string;
  active?: number;
  typing?: boolean;
  pressed?: boolean;
  rows?: number;
  className?: string;
}) {
  const items = searchItems.filter(([name]) => name.includes(query)).slice(0, rows);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-[#1a1f2c] shadow-2xl shadow-black/60", className)}>
      <div className="px-3 pt-2 text-center text-[10px] text-muted-foreground">Search objects · Shop · Postgres</div>
      <div className="mx-2 mt-1.5 flex h-7 items-center gap-2 rounded-md border border-brand/60 bg-black/30 px-2 text-[11.5px]">
        <Search className="size-3 text-muted-foreground" />
        {query ? (
          <span className="text-foreground">
            {query}
            {typing && <Caret />}
          </span>
        ) : (
          <span className="truncate text-muted-foreground/70">Search tables, schemas, databases, views and functions…</span>
        )}
      </div>
      <ul className="mt-1.5 pb-1.5 text-[11.5px]" style={rows ? { minHeight: rows * 25 + 6 } : undefined}>
        {items.map(([name, kind, where], i) => {
          const at = query ? name.indexOf(query) : -1;
          return (
            <li
              key={name}
              className={cn(
                "mx-1.5 flex h-[25px] items-center gap-2 rounded px-2 transition-colors",
                i === active && (pressed ? "bg-brand/60" : "bg-brand/30"),
              )}
            >
              {kind === "table" ? (
                <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
              ) : kind === "view" ? (
                <Table2 className="size-3.5 shrink-0 text-sky-300/80" />
              ) : (
                <Braces className="size-3.5 shrink-0 text-amber-300/80" />
              )}
              <span className="shrink-0 text-foreground">
                {at < 0 ? (
                  name
                ) : (
                  <>
                    {name.slice(0, at)}
                    <span className="font-semibold text-brand">{name.slice(at, at + query.length)}</span>
                    {name.slice(at + query.length)}
                  </>
                )}
              </span>
              <span className="truncate text-[10.5px] text-muted-foreground">{where}</span>
              {i === active && <CornerDownLeft className="ml-auto size-3 shrink-0 text-muted-foreground" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SearchScene({ t }: { t: number }) {
  const open = t < 3000;
  const query = typed("ord", t, 700, 180);
  return (
    <div className="relative h-full">
      <OrdersGrid t={Infinity} scene="search" />
      {open && (
        <>
          <div className="absolute inset-0 bg-black/45 motion-safe:animate-in motion-safe:fade-in" />
          <div className="absolute inset-x-0 top-3 flex justify-center px-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2">
            <SearchPalette
              query={query}
              typing={between(t, 500, 1400)}
              active={0}
              pressed={between(t, 2500, 3000)}
              className="w-full max-w-[460px]"
            />
          </div>
        </>
      )}
    </div>
  );
}

function QueryScene({ t }: { t: number }) {
  const text = typed(aiPrompt, t, 200, 55);
  const typing = between(t, 200, 2500);
  const generating = between(t, 2500, 3300);
  const sql = typed(aiSql, t, 3300, 12);
  const streaming = between(t, 3300, 3300 + aiSql.length * 12);
  const showResults = t >= 6900;
  return (
    <div className="relative flex h-full flex-col gap-3 overflow-hidden px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <Sparkles className="size-3.5 text-brand" />
            Generate query with AI
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            Describe what you need. Your database context is already included.
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="hidden rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground sm:inline">
            AI agents (MCP)
          </span>
          <span className="grid size-5 place-items-center rounded-full border border-border">
            <Settings className="size-3 text-muted-foreground" />
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-[10.5px]">
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="text-foreground/90">Database context</span>
        <span className="font-mono text-muted-foreground">shop.public · 7 tables · automatic context</span>
      </div>
      <div
        className={cn(
          "rounded-lg border bg-black/30 transition-colors duration-300",
          typing ? "border-brand/70" : "border-border",
        )}
      >
        <div className="min-h-[38px] px-3 pt-2 text-[12px]">
          {text ? (
            <span className="text-foreground">
              {text}
              {typing && <Caret />}
            </span>
          ) : (
            <span className="text-muted-foreground/60">
              e.g. Show the 10 customers with the highest order total this month
            </span>
          )}
        </div>
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="pl-1 text-[10px] text-muted-foreground">Write in any language</span>
          <span className="flex items-center gap-1.5">
            <Btn>Cancel</Btn>
            <Btn primary pressed={between(t, 2350, 2600)}>
              {generating ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              {generating ? "Generating…" : "Generate query"}
            </Btn>
          </span>
        </div>
      </div>
      {t >= 3300 && (
        <div className="rounded-lg border border-border bg-black/40 motion-safe:animate-in motion-safe:fade-in">
          <pre className="overflow-hidden px-3 py-2.5 font-mono text-[10.5px] leading-[1.6] whitespace-pre text-foreground/90">
            <SqlCode code={sql} />
            {streaming && <Caret />}
          </pre>
          <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5">
            <Btn primary pressed={between(t, 6300, 6600)}>
              Open in query editor
            </Btn>
            <Btn>
              <Copy className="size-3" />
              Copy
            </Btn>
            <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">Review before you run it</span>
          </div>
        </div>
      )}
      {showResults && (
        <div className="absolute inset-x-0 bottom-0 border-t border-brand/40 bg-[#141926]/95 backdrop-blur-sm motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:fade-in">
          <div className="flex items-center justify-between px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="tracking-[0.15em] uppercase">Query results</span>
            <span>5 rows · 11 ms</span>
          </div>
          {revenue.map(([name, total], i) => (
            <div
              key={name}
              className="flex h-[23px] items-center border-t border-border/50 px-4 font-mono text-[11px] motion-safe:animate-in motion-safe:fade-in"
              style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}
            >
              <span className="w-6 text-muted-foreground">{i + 1}</span>
              <span className="flex-1 text-foreground/90">{name}</span>
              <span className="text-emerald-300 tabular-nums">{total}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const W = 168;
const HEAD = 26;
const ROW = 19;

type DiagramTable = { name: string; x: number; y: number; cols: [string, string, string?][] };

const diagram: DiagramTable[] = [
  { name: "customers", x: 16, y: 20, cols: [["id", "integer", "PK"], ["email", "text"], ["full_name", "text"], ["country", "char(2)"]] },
  {
    name: "orders",
    x: 236,
    y: 20,
    cols: [["id", "integer", "PK"], ["customer_id", "integer", "FK"], ["status", "text"], ["total", "numeric"], ["placed_at", "timestamptz"]],
  },
  {
    name: "order_items",
    x: 456,
    y: 20,
    cols: [["order_id", "integer", "FK"], ["product_id", "integer", "FK"], ["quantity", "integer"], ["unit_price", "numeric"]],
  },
  { name: "shipments", x: 16, y: 206, cols: [["id", "integer", "PK"], ["order_id", "integer", "FK"], ["carrier", "text"]] },
  { name: "payments", x: 236, y: 214, cols: [["id", "integer", "PK"], ["order_id", "integer", "FK"], ["amount", "numeric"]] },
  { name: "products", x: 456, y: 206, cols: [["id", "integer", "PK"], ["name", "text"], ["price", "numeric"]] },
];

const relations: [string, number, string, number, ("left" | "right")?][] = [
  ["orders", 1, "customers", 0],
  ["order_items", 0, "orders", 0],
  ["shipments", 1, "orders", 0],
  ["payments", 1, "orders", 0, "right"],
  ["order_items", 1, "products", 0, "left"],
];

function table(name: string) {
  return diagram.find((d) => d.name === name)!;
}

function rowY(d: DiagramTable, i: number) {
  return d.y + HEAD + i * ROW + ROW / 2;
}

function relationPath([from, fi, to, ti, side]: (typeof relations)[number]) {
  const a = table(from);
  const b = table(to);
  const y1 = rowY(a, fi);
  const y2 = rowY(b, ti);
  if (side === "right") return `M${a.x + W} ${y1} C${a.x + W + 36} ${y1} ${b.x + W + 36} ${y2} ${b.x + W} ${y2}`;
  if (side === "left") return `M${a.x} ${y1} C${a.x - 30} ${y1} ${b.x - 30} ${y2} ${b.x} ${y2}`;
  const [x1, x2] = a.x < b.x ? [a.x + W, b.x] : [a.x, b.x + W];
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

function DiagramScene({ t, motion }: { t: number; motion: boolean }) {
  const query = typed("order", t, 4400, 130);
  const searching = t >= 4400;
  const hit = (name: string) => !query || name.includes(query);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px]">
        <span className="font-medium">public · Diagram</span>
        <span
          className={cn(
            "ml-auto flex h-6 w-28 items-center gap-1.5 rounded-md border bg-black/30 px-2 sm:w-40",
            searching ? "border-brand/70" : "border-border",
          )}
        >
          <Search className="size-3 shrink-0 text-muted-foreground" />
          {query ? (
            <span className="truncate">
              {query}
              {between(t, 4400, 5200) && <Caret />}
            </span>
          ) : (
            <span className="truncate text-muted-foreground/60">Find table or column…</span>
          )}
        </span>
        <Btn className="hidden sm:inline-flex">Arrange</Btn>
        <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">− 76% +</span>
        <Btn className="hidden lg:inline-flex">Fit</Btn>
      </div>
      <div className="relative min-h-0 flex-1 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:16px_16px]">
        <svg viewBox="0 0 640 316" className="absolute inset-0 size-full p-3" role="img" aria-label="Schema diagram">
          {relations.map((r, i) => {
            const d = relationPath(r);
            const drawn = t >= 1300 + i * 260;
            const lit = searching && query && (r[0].includes(query) || r[2].includes(query));
            return (
              <g key={i}>
                <path
                  d={d}
                  pathLength={1}
                  fill="none"
                  strokeWidth={lit ? 1.8 : 1.2}
                  className={cn("transition-all duration-700 ease-out", lit ? "stroke-brand" : "stroke-brand/55")}
                  style={{ strokeDasharray: 1, strokeDashoffset: drawn ? 0 : 1 }}
                />
                {drawn && motion && (
                  <circle r={2.4} className="fill-brand">
                    <animateMotion dur="2.6s" begin={`${i * 0.35}s`} repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
          {diagram.map((d, i) => {
            const shown = t >= i * 160;
            const on = hit(d.name);
            const h = HEAD + d.cols.length * ROW;
            return (
              <g key={d.name} transform={`translate(${d.x} ${d.y})`}>
                <g
                  className="transition-all duration-500 ease-out"
                  style={{ opacity: shown ? (on ? 1 : 0.3) : 0, transform: `translateY(${shown ? 0 : 10}px)` }}
                >
                  <rect
                    width={W}
                    height={h}
                    rx={6}
                    className={cn("fill-[#1b2030] transition-colors duration-300", searching && on ? "stroke-brand" : "stroke-white/10")}
                  />
                  <rect width={W} height={2.5} rx={1} className="fill-brand" />
                  <text x={10} y={17} className="fill-foreground font-sans text-[10.5px] font-semibold">
                    {d.name}
                  </text>
                  <text x={W - 10} y={17} textAnchor="end" className="fill-muted-foreground font-mono text-[7.5px]">
                    public
                  </text>
                  {d.cols.map(([name, type, key], j) => (
                    <g key={name} transform={`translate(0 ${HEAD + j * ROW})`}>
                      <line x1={0} x2={W} className="stroke-white/[0.06]" />
                      {key && (
                        <text x={10} y={12.5} className={cn("font-mono text-[7px]", key === "PK" ? "fill-amber-300" : "fill-brand")}>
                          {key}
                        </text>
                      )}
                      <text x={28} y={12.5} className="fill-foreground/85 font-mono text-[9px]">
                        {name}
                      </text>
                      <text x={W - 10} y={12.5} textAnchor="end" className="fill-muted-foreground font-mono text-[8px]">
                        {type}
                      </text>
                    </g>
                  ))}
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
        <span>6 tables · 5 FK column links</span>
        <span className="hidden sm:inline">Drag tables · Pan · Zoom</span>
      </div>
    </div>
  );
}

export function ProductDemo() {
  const reduced = useReducedMotion();
  const { ref: root, visible } = useInView<HTMLElement>();
  const [state, setState] = useState({ scene: 0, t: 0 });
  const playing = visible && !reduced;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setState((s) => {
        const t = s.t + dt;
        return t >= scenes[s.scene].dur ? { scene: (s.scene + 1) % scenes.length, t: 0 } : { scene: s.scene, t };
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing]);

  const scene = scenes[state.scene];
  const t = reduced ? Infinity : state.t;
  const active =
    scene.id === "query" || scene.id === "diagram" ? "public" : scene.id === "browse" && t < 200 ? "" : "orders";

  return (
    <figure ref={root}>
      <Frame className="relative">
        <FrameChrome
          left="vs code · dbdeck"
          right={
            <span className="inline-flex items-center gap-1.5 text-brand">
              <span className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
              {scene.label}
            </span>
          }
        />
        <div className="flex h-[440px] sm:h-[480px] lg:h-[520px]">
          <Sidebar active={active} sparkle={scene.id === "query"} />
          <div className="flex min-w-0 flex-1 flex-col bg-card/30">
            <EditorTabs scene={scene.id} />
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div key={scene.id} className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
                {(scene.id === "browse" || scene.id === "filter") && <OrdersGrid t={t} scene={scene.id} />}
                {scene.id === "search" && <SearchScene t={t} />}
                {scene.id === "query" && <QueryScene t={t} />}
                {scene.id === "diagram" && <DiagramScene t={t} motion={!reduced} />}
              </div>
            </div>
          </div>
        </div>
      </Frame>
      <div className="mt-4 grid grid-cols-5 gap-1.5 sm:gap-2">
        {scenes.map((s, i) => {
          const on = i === state.scene;
          const progress = on ? Math.min(1, t / s.dur) : i < state.scene ? 1 : 0;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => setState({ scene: i, t: 0 })}
              className="group flex min-w-0 flex-col justify-start text-left"
            >
              <span className="block h-0.5 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full origin-left bg-brand transition-transform duration-100 ease-linear"
                  style={{ transform: `scaleX(${progress})` }}
                />
              </span>
              <span
                className={cn(
                  "mt-2 block truncate font-mono text-[9px] tracking-[0.06em] whitespace-nowrap uppercase transition-colors sm:text-[10px] sm:tracking-[0.2em]",
                  on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80",
                )}
              >
                {s.label}
              </span>
              <span className="mt-0.5 hidden text-[12px] text-muted-foreground sm:block">{s.hint}</span>
            </button>
          );
        })}
      </div>
      <figcaption>
        <Caption>Fig. 02 — browse, search, ask AI, see the relations</Caption>
      </figcaption>
    </figure>
  );
}
