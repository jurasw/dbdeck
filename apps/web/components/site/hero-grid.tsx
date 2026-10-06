import { Copy, CornerDownRight, Plus, Sparkles, Table2 } from "lucide-react";
import { Frame, FrameChrome } from "./primitives";
import { SqlCode } from "./sql-code";

const rows = [
  ["1201", "Anna Kowalska", "PL", "paid", "412.00"],
  ["1195", "Piotr Zieliński", "PL", "paid", "248.40"],
  ["1188", "Jan Nowak", "PL", "paid", "186.50"],
  ["1176", "Zofia Wójcik", "PL", "paid", "164.90"],
  ["1169", "Marek Lis", "PL", "paid", "129.00"],
  ["1152", "Ola Mazur", "PL", "paid", "118.20"],
];

export function HeroGrid() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(91,140,255,0.22),transparent)] blur-2xl"
      />
      <Frame>
        <FrameChrome
          left="orders · shop · postgres"
          right={
            <span className="inline-flex items-center gap-1.5 text-brand">
              <Sparkles className="size-3" /> ai
            </span>
          }
        />
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
          <span className="grid size-7 place-items-center rounded-md border border-border bg-white/[0.03]">
            <Table2 className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-tight font-medium">orders</span>
            <span className="block truncate text-[10.5px] text-muted-foreground">Shop · Postgres › shop › public</span>
          </span>
          <span className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span>DDL</span>
            <span>CSV</span>
            <span>JSON</span>
          </span>
        </div>
        <div className="px-4 pb-3">
          <div className="rounded-lg border border-brand/40 bg-brand/[0.07] px-3 py-2 text-[12px]">
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.18em] text-brand uppercase">
              <Sparkles className="size-3" />
              you wrote
            </span>
            <span className="mt-1 block text-foreground/90">paid orders from Poland over 100</span>
          </div>
          <div className="ml-4 flex h-4 items-center text-brand/70">
            <CornerDownRight className="size-3" />
          </div>
          <div className="flex items-start gap-2">
            <div className="flex min-h-8 min-w-0 flex-1 items-stretch rounded-md border border-brand/50 bg-black/30 font-mono text-[11.5px] shadow-[0_0_0_3px_rgba(91,140,255,0.08)]">
              <span className="flex items-center border-r border-border px-2 text-[9px] tracking-[0.15em] text-muted-foreground">
                WHERE
              </span>
              <span className="min-w-0 flex-1 self-center px-2 py-1.5 leading-[1.5]">
                <SqlCode code="status = 'paid' AND country = 'PL' AND total > 100" />
              </span>
              <span className="mr-1 grid size-6 shrink-0 place-items-center self-center rounded bg-brand/20">
                <Sparkles className="size-3.5 text-brand motion-safe:animate-pulse" />
              </span>
            </div>
            <span className="inline-flex h-8 shrink-0 items-center rounded-md bg-white px-3 text-[11px] font-medium text-black">Apply</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-y border-border px-4 py-1.5 text-[10.5px] text-foreground/80">
          <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-white/[0.03] px-2">
            <Plus className="size-3" /> Add row
          </span>
          <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-white/[0.03] px-2">
            <Copy className="size-3" /> Duplicate
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">6 of 1,200 · 6 ms</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] table-fixed text-left font-mono text-[12px]">
            <thead className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase">
              <tr className="border-b border-border">
                <th className="w-14 px-4 py-2 font-medium">id</th>
                <th className="px-3 py-2 font-medium">customer</th>
                <th className="w-12 px-3 py-2 font-medium">cc</th>
                <th className="w-20 px-3 py-2 font-medium">status</th>
                <th className="w-20 px-4 py-2 text-right font-medium">total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, name, cc, status, total], i) => (
                <tr
                  key={id}
                  className={`border-b border-border/60 transition-colors last:border-0 hover:bg-brand/10 ${i === 1 ? "bg-brand/15 shadow-[inset_2px_0_0_var(--brand)]" : ""}`}
                >
                  <td className="px-4 py-[7px] text-muted-foreground tabular-nums">{id}</td>
                  <td className="truncate px-3 py-[7px] text-foreground/90">{name}</td>
                  <td className="px-3 py-[7px] text-muted-foreground">{cc}</td>
                  <td className="px-3 py-[7px] text-brand">{status}</td>
                  <td className="px-4 py-[7px] text-right text-foreground/90 tabular-nums">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-black/20 px-4 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" /> connected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-brand" /> MCP · read-only
          </span>
        </div>
      </Frame>
    </div>
  );
}
