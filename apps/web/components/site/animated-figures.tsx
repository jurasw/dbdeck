"use client";

import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { between, Caret, cycle, Reserve, typed, useClock } from "./motion";
import { Frame, FrameChrome, Kbd } from "./primitives";
import { SearchPalette, searchItems } from "./product-demo";
import { SqlCode } from "./sql-code";

const paidOrders = [
  ["Anna Kowalska", "412.00"],
  ["Piotr Zieliński", "248.40"],
  ["Jan Nowak", "186.50"],
  ["Lucas Silva", "126.90"],
];

export function SqlFigure({ code }: { code: string }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const typeEnd = 400 + code.length * 45;
  const ready = typeEnd + 1300;
  const rerun = cycle(t, ready + 3500, 6500);
  const pressed = between(t, typeEnd + 400, typeEnd + 700) || between(rerun, 0, 300);
  const running = between(t, typeEnd + 600, ready) || between(rerun, 200, 900);
  const done = t >= ready;
  return (
    <div ref={ref}>
      <Frame>
        <div className="flex items-center gap-2 border-b border-border px-6 py-4 text-sm text-muted-foreground">
          <span aria-hidden className={cn("size-2 rounded-full bg-brand", running && "animate-pulse")} />
          orders.sql
        </div>
        <pre className="overflow-x-auto px-5 pt-8 pb-6 font-mono text-base leading-loose sm:px-8 sm:text-xl">
          <code>
            <Reserve full={<SqlCode code={code} />}>
              <SqlCode code={typed(code, t, 400, 45)} />
              {t < typeEnd + 400 && <Caret />}
            </Reserve>
          </code>
        </pre>
        <div className="border-t border-border font-mono text-[13px] sm:text-sm">
          {paidOrders.map(([name, total], i) => (
            <div
              key={name}
              className={cn(
                "flex items-center justify-between border-b border-border/50 px-6 py-2 transition-all duration-500",
                t >= ready + i * 120 ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                done && running && "opacity-40",
                between(rerun, 900 + i * 120, 1500 + i * 120) && "bg-brand/10",
              )}
            >
              <span className="text-foreground/90">{name}</span>
              <span className="text-emerald-300 tabular-nums">{total}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-6 py-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            {running ? (
              <>
                <Loader2 className="size-3.5 animate-spin text-brand" />
                Running…
              </>
            ) : done ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
                {paidOrders.length} rows returned · 3 ms
              </>
            ) : (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-white/20" />
                Ready
              </>
            )}
          </span>
          <span className={cn("rounded transition-all duration-200", pressed && "scale-90 ring-2 ring-brand")}>
            <Kbd>⌘ Enter</Kbd>
          </span>
        </div>
      </Frame>
    </div>
  );
}

type SchemaTable = { name: string; columns: string[][] };

export function SchemaFigure({ tables, link }: { tables: SchemaTable[]; link: { from: string; to: string } }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const linked = t >= 2400;
  const flow = cycle(t, 3200, 2800);
  const travel = Math.min(1, Math.max(0, (flow - 500) / 1100));
  const eased = travel < 0.5 ? 2 * travel * travel : 1 - (-2 * travel + 2) ** 2 / 2;
  const fromFirst = link.from.startsWith(`${tables[0].name}.`);
  const pos = fromFirst ? eased : 1 - eased;
  const lit = (key: string) =>
    (key === link.from && between(flow, 0, 1000)) || (key === link.to && between(flow, 1500, 2500));
  return (
    <div ref={ref} className="flex flex-col items-center rounded-2xl border border-border bg-card/20 px-5 py-10 sm:flex-row sm:px-8 sm:py-16">
      {tables.map((table, i) => {
        const tableLit = table.columns.some(([name]) => lit(`${table.name}.${name}`));
        return (
          <div key={table.name} className="contents">
            {i > 0 && (
              <div aria-hidden className="relative h-16 w-px shrink-0 sm:h-px sm:w-16">
                <span
                  className={cn(
                    "absolute inset-0 origin-top bg-brand/50 transition-transform duration-700 ease-out sm:origin-left",
                    linked ? "scale-100" : "scale-0",
                  )}
                />
                {["0%", "100%"].map((at) => (
                  <span
                    key={at}
                    className={cn(
                      "absolute top-[var(--p)] left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/70 transition-opacity duration-300 sm:top-1/2 sm:left-[var(--p)]",
                      linked ? "opacity-100" : "opacity-0",
                    )}
                    style={{ "--p": at } as React.CSSProperties}
                  />
                ))}
                <span
                  className={cn(
                    "absolute top-[var(--p)] left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_var(--brand)] transition-opacity duration-200 sm:top-1/2 sm:left-[var(--p)]",
                    between(flow, 400, 1700) ? "opacity-100" : "opacity-0",
                  )}
                  style={{ "--p": `${pos * 100}%` } as React.CSSProperties}
                />
              </div>
            )}
            <div
              className={cn(
                "w-full min-w-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/20 transition-all duration-500",
                t >= i * 400 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                tableLit ? "border-brand/70 shadow-[0_0_28px_-8px_var(--brand)]" : "border-brand/30",
              )}
            >
              <div className="border-b border-border px-5 py-4 text-base font-semibold sm:text-lg">{table.name}</div>
              <ul className="space-y-3 px-5 py-5 font-mono text-sm sm:text-base">
                {table.columns.map(([name, type], j) => (
                  <li
                    key={name}
                    className={cn(
                      "-mx-2 -my-0.5 flex items-center justify-between gap-3 rounded px-2 py-0.5 transition-all duration-500",
                      t >= 400 + i * 500 + j * 160 ? "opacity-100" : "opacity-0",
                      lit(`${table.name}.${name}`) && "bg-brand/15",
                    )}
                  >
                    <span>{name}</span>
                    <span className={type === "PK" || type === "FK" ? "text-brand" : "text-muted-foreground"}>{type}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function editedValue(from: string, to: string, c: number) {
  if (c < 400) return from;
  if (c < 800) return from.slice(0, Math.max(0, from.length - Math.floor((c - 400) / 100)));
  return typed(to, c, 800, 130);
}

export function RedisFigure({ fields, edit }: { fields: string[][]; edit: [string, string] }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const period = 7000;
  const c = cycle(t, 2200, period);
  const round = Math.floor((t - 2200) / period);
  const editing = between(c, 0, 1700);
  const saved = between(c, 1700, 4500);
  return (
    <div ref={ref}>
      <Frame>
        <div className="flex items-center gap-3 border-b border-border px-5 py-5 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/types/redis-on.svg" alt="Redis" width={28} height={28} className="size-7" />
          <span className="font-mono text-base font-medium sm:text-lg">user:42</span>
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 text-xs text-emerald-300 transition-opacity duration-300",
              saved ? "opacity-100" : "opacity-0",
            )}
          >
            <Check className="size-3.5" />
            Saved
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Hash</span>
        </div>
        <table className="w-full table-fixed text-left text-sm sm:text-base">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="w-1/3 px-5 py-3 font-normal sm:px-6">Field</th>
              <th className="px-5 py-3 font-normal sm:px-6">Value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([field, value], i) => {
              const target = field === edit[0];
              const [from, to] = round % 2 === 0 ? [value, edit[1]] : [edit[1], value];
              return (
                <tr
                  key={field}
                  className={cn(
                    "border-b border-border/60 transition-all duration-500 last:border-0",
                    t >= 200 + i * 150 ? "opacity-100" : "opacity-0",
                    target && editing && "bg-brand/[0.06]",
                  )}
                >
                  <td className="px-5 py-4 font-mono text-muted-foreground sm:px-6">{field}</td>
                  <td className="break-words px-5 py-4 sm:px-6">
                    {target ? (
                      <span
                        className={cn(
                          "-mx-1.5 rounded px-1.5 py-0.5 ring-1 transition-all duration-300",
                          editing ? "bg-black/30 ring-brand/70" : "ring-transparent",
                          saved && "text-emerald-300",
                        )}
                      >
                        {c < 0 ? value : editedValue(from, to, c)}
                        {editing && <Caret />}
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Frame>
    </div>
  );
}

function SqlLines({ code, lit, caret }: { code: string; lit?: number; caret?: boolean }) {
  const lines = code.split("\n");
  return lines.map((line, i) => (
    <span key={i} className={cn("-mx-2 block rounded px-2 transition-colors duration-300", i === lit && "bg-brand/10")}>
      <SqlCode code={line} />
      {caret && i === lines.length - 1 && <Caret />}
    </span>
  ));
}

export function AiFigure({ prompt, sql }: { prompt: string; sql: string }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const typeEnd = 300 + prompt.length * 55;
  const typing = t < typeEnd + 200;
  const generating = between(t, typeEnd + 300, typeEnd + 1100);
  const streamStart = typeEnd + 1100;
  const streamEnd = streamStart + sql.length * 22;
  const done = t >= streamEnd;
  const sweep = cycle(t, streamEnd + 1500, 5500);
  return (
    <div ref={ref}>
      <Frame>
        <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm text-brand sm:px-6">
          <Sparkles className="size-4" /> AI Query
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity duration-300",
              generating ? "opacity-100" : "opacity-0",
            )}
          >
            <Loader2 className="size-3.5 animate-spin text-brand" />
            Generating…
          </span>
        </div>
        <div
          className={cn(
            "m-5 rounded-xl border bg-brand/5 px-5 py-4 text-base leading-relaxed transition-colors duration-300 sm:m-6 sm:text-lg",
            typing || between(sweep, 0, 700) ? "border-brand/60" : "border-brand/25",
          )}
        >
          <Reserve full={prompt}>
            <span>
              {typed(prompt, t, 300, 55)}
              {typing && <Caret />}
            </span>
          </Reserve>
        </div>
        <pre className="overflow-x-auto px-5 pb-6 font-mono text-base leading-loose sm:px-6 sm:text-xl">
          <code>
            <Reserve full={<SqlLines code={sql} />}>
              <span>
                <SqlLines
                  code={typed(sql, t, streamStart, 22)}
                  lit={sweep >= 500 ? Math.floor((sweep - 500) / 650) : -1}
                  caret={between(t, streamStart, streamEnd)}
                />
              </span>
            </Reserve>
          </code>
        </pre>
        <div className="flex items-center gap-2 border-t border-border px-5 py-4 text-sm text-muted-foreground sm:px-6">
          <Check className={cn("size-3.5 text-emerald-300 transition-opacity duration-300", done ? "opacity-100" : "opacity-0")} />
          Schema shared. Rows and credentials stay private.
        </div>
      </Frame>
    </div>
  );
}

export function PrivacyFigure({ rows, note }: { rows: string[][]; note: string }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const scanStart = 300 + rows.length * 260;
  const noteStart = scanStart + rows.length * 450;
  const scan = cycle(t, scanStart, rows.length * 450 + 3000);
  return (
    <div ref={ref}>
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
              {rows.map(([data, where, note], i) => (
                <tr
                  key={data}
                  className={cn(
                    "border-b border-border/60 transition-all duration-500 last:border-0",
                    t >= 300 + i * 260 ? "opacity-100" : "opacity-0",
                    between(scan, i * 450, (i + 1) * 450) && "bg-brand/10",
                  )}
                >
                  <td className="px-4 py-3 text-foreground/90">{data}</td>
                  <td className="px-4 py-3 text-muted-foreground">{where}</td>
                  <td className="px-4 py-3 text-brand">
                    <span className="inline-flex items-center gap-1.5">
                      <Check
                        className={cn(
                          "size-3 transition-all duration-300",
                          t >= scanStart + i * 450 ? "scale-100 opacity-100" : "scale-50 opacity-0",
                        )}
                      />
                      {note}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-black/20 px-4 py-2 font-mono text-[11px] text-muted-foreground/80 italic">
          <Reserve full={note}>
            <span>
              {typed(note, t, noteStart, 28)}
              {between(t, noteStart, noteStart + note.length * 28 + 600) && <Caret />}
            </span>
          </Reserve>
        </div>
      </Frame>
    </div>
  );
}

const searchQueries = ["ord", "cust", "pay"];
const searchCycle = 3600;
const searchRows = 5;

export function SearchFigure({ className }: { className?: string }) {
  const { ref, t } = useClock<HTMLDivElement>();
  const still = !Number.isFinite(t);
  const step = Math.floor(t / searchCycle) % searchQueries.length;
  const q = still ? searchQueries[0] : searchQueries[step];
  const lt = still ? Infinity : t % searchCycle;
  const query = typed(q, lt, 400, 170);
  const doneAt = 400 + q.length * 170;
  const count = Math.min(searchRows, searchItems.filter(([name]) => name.includes(query)).length);
  const active = still ? 0 : Math.max(0, Math.min(count - 1, Math.floor((lt - doneAt - 300) / 380)));
  return (
    <div ref={ref} className={className}>
      <SearchPalette
        query={query}
        typing={lt < doneAt + 300}
        active={active}
        pressed={!still && lt >= searchCycle - 600}
        rows={searchRows}
      />
    </div>
  );
}
