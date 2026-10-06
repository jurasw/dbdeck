import { Frame, FrameChrome } from "./primitives";

const rows = [
  ["1187", "Mia Novak", "CZ", "paid", "182.90"],
  ["1186", "Oliver Berg", "SE", "shipped", "74.90"],
  ["1185", "Ava Jensen", "DK", "delivered", "311.90"],
  ["1184", "Emma Dubois", "FR", "refunded", "48.90"],
  ["1183", "Lucas Silva", "PT", "paid", "126.90"],
  ["1182", "Anna Kowalska", "PL", "pending", "205.90"],
  ["1181", "Zoe Kim", "KR", "delivered", "89.90"],
];

const statusTone: Record<string, string> = {
  paid: "text-brand",
  shipped: "text-sky-300",
  delivered: "text-emerald-300",
  refunded: "text-rose-300",
  pending: "text-amber-300",
};

export function HeroGrid() {
  return (
    <Frame>
      <FrameChrome left="orders · shop · postgres" right={<span className="text-brand">1,200 rows</span>} />
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 font-mono text-[11.5px]">
        <span className="rounded border border-border bg-white/5 px-1.5 py-0.5 text-[10px] tracking-[0.15em] text-muted-foreground uppercase">
          where
        </span>
        <span className="truncate text-foreground/80">
          status <span className="text-muted-foreground">in</span> (<span className="text-amber-200">&apos;paid&apos;</span>,{" "}
          <span className="text-amber-200">&apos;shipped&apos;</span>)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed text-left font-mono text-[12px]">
          <thead className="text-[10px] tracking-[0.15em] text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="w-14 px-4 py-2.5 font-medium">id</th>
              <th className="px-3 py-2.5 font-medium">customer</th>
              <th className="w-12 px-3 py-2.5 font-medium">cc</th>
              <th className="w-24 px-3 py-2.5 font-medium">status</th>
              <th className="w-20 px-4 py-2.5 text-right font-medium">total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, name, cc, status, total]) => (
              <tr key={id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-brand/10">
                <td className="px-4 py-2 text-muted-foreground tabular-nums">{id}</td>
                <td className="truncate px-3 py-2 text-foreground/90">{name}</td>
                <td className="px-3 py-2 text-muted-foreground">{cc}</td>
                <td className={`px-3 py-2 ${statusTone[status]}`}>{status}</td>
                <td className="px-4 py-2 text-right text-foreground/90 tabular-nums">{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-black/20 px-4 py-2 font-mono text-[11px] text-muted-foreground">
        <span>1–7 of 1,200 · 4 ms</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-400" /> connected
        </span>
      </div>
    </Frame>
  );
}
