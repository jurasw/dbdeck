import { Lock } from "lucide-react";
import { Caption, Frame, FrameChrome, Heading, Lede, Shell, SmallList } from "./primitives";
import { SearchPalette } from "./product-demo";

const groups: { title: string; note: string; items: { label: string; icon?: string; depth?: number; lock?: boolean }[] }[] = [
  {
    title: "Connections",
    note: "your folders",
    items: [
      { label: "Local" },
      { label: "Shop · Postgres", icon: "postgres", depth: 1 },
      { label: "Staging" },
      { label: "Events · MongoDB", icon: "mongodb", depth: 1 },
      { label: "Production" },
      { label: "Shop · Postgres", icon: "postgres", depth: 1, lock: true },
    ],
  },
  {
    title: "Redis keys",
    note: "split on :",
    items: [
      { label: "user", icon: "redis" },
      { label: "user:42", depth: 1 },
      { label: "user:43", depth: 1 },
      { label: "session", icon: "redis" },
      { label: "cart", icon: "redis" },
      { label: "cart:42:items", depth: 1 },
    ],
  },
  {
    title: "Docker",
    note: "by Compose project",
    items: [
      { label: "shop", icon: "docker" },
      { label: "postgres", depth: 1 },
      { label: "redis", depth: 1 },
      { label: "analytics", icon: "docker" },
      { label: "clickhouse", depth: 1 },
      { label: "minio", depth: 1 },
    ],
  },
];

export function Organize() {
  return (
    <section>
      <Shell>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-4">
            <Heading lead="Grouped your way." rest="Found in a keystroke." />
            <Lede>
              Put connections into groups like Local, Staging and Production. Search Database Objects finds a table, view,
              schema or function by name and shows the folder it lives in. Pick one and the tree jumps to it.
            </Lede>
            <SmallList
              items={[
                "Connection groups, read-only where it matters",
                "Search tables, views, schemas and functions",
                "Redis keys grouped by separator",
                "Docker containers grouped by Compose project",
                "Find a table or column in the schema diagram",
              ]}
            />
          </div>
          <div className="lg:col-span-8">
            <Frame>
              <FrameChrome left="search objects · shop · postgres" right={<span className="text-brand">4 results</span>} />
              <div className="bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px] px-4 py-6 sm:px-10">
                <SearchPalette query="ord" className="mx-auto max-w-[520px]" />
              </div>
              <div className="grid grid-cols-1 border-t border-border sm:grid-cols-3">
                {groups.map((g) => (
                  <div key={g.title} className="border-b border-border/60 px-5 py-4 last:border-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-foreground">{g.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{g.note}</span>
                    </div>
                    <ul className="mt-3 space-y-1.5 font-mono text-[11.5px]">
                      {g.items.map((it, i) => (
                        <li
                          key={i}
                          className={`flex items-center gap-2 ${it.depth ? "pl-4 text-muted-foreground" : "text-foreground/90"}`}
                        >
                          {it.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/types/${it.icon}-on.svg`} alt="" width={12} height={12} className="size-3" />
                          ) : (
                            <span aria-hidden className={`size-1 rounded-full ${it.depth ? "bg-white/25" : "bg-brand"}`} />
                          )}
                          <span className="truncate">{it.label}</span>
                          {it.lock && <Lock className="ml-auto size-3 shrink-0 text-amber-300/80" />}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Frame>
            <Caption>Fig. 04 — one search box, every object</Caption>
          </div>
        </div>
      </Shell>
    </section>
  );
}
