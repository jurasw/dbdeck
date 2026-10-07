import { Check } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { cn } from "../lib/cn";
import { between, ramp, rise, typed } from "../lib/motion";
import { Cursor } from "../ui/cursor";
import { Caret, Frame, TypeIcon } from "../ui/primitives";
import { Camera, useShot } from "../ui/stage";

const fields = [
  ["name", "Anna Kowalska"],
  ["email", "anna@example.com"],
  ["country", "PL"],
  ["plan", "pro"],
];

const editAt = 1100;

function editedValue(from: string, to: string, c: number) {
  if (c < 0) return from;
  if (c < 300) return from.slice(0, Math.max(0, from.length - Math.floor(c / 100)));
  return typed(to, c, 300, 120);
}

function RedisCard({ t }: { t: number }) {
  const c = t - editAt;
  const editing = between(c, 0, 1300);
  const saved = c >= 1300;
  return (
    <Frame className="w-[560px]">
      <div className="flex items-center gap-3 border-b border-border px-6 py-5">
        <TypeIcon name="redis" className="size-7" />
        <span className="font-mono text-lg font-medium">user:42</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-300" style={{ opacity: ramp(c, 1300, 300) }}>
          <Check className="size-3.5" />
          Saved
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Hash</span>
      </div>
      <table className="w-full table-fixed text-left text-base">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="w-1/3 px-6 py-3 font-normal">Field</th>
            <th className="px-6 py-3 font-normal">Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([field, value], i) => {
            const target = field === "plan";
            return (
              <tr key={field} className={cn("border-b border-border/60 last:border-0", target && editing && "bg-brand/[0.06]")} style={rise(t, 150 + i * 120, 450, 6)}>
                <td className="px-6 py-4 font-mono text-muted-foreground">{field}</td>
                <td className="px-6 py-4">
                  {target ? (
                    <span className={cn("-mx-1.5 rounded px-1.5 py-0.5 ring-1", editing ? "bg-black/30 ring-brand/70" : "ring-transparent", saved && "text-emerald-300")}>
                      {editedValue(value, "team", c)}
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
  );
}

function MongoCard({ t }: { t: number }) {
  const lines = [
    ["_id", "ObjectId('6721…f3')", "text-muted-foreground"],
    ["type", "'checkout'", "text-amber-200"],
    ["user", "42", "text-emerald-300"],
    ["total", "412.00", "text-emerald-300"],
    ["items", "[ 3 ]", "text-sky-300"],
  ];
  return (
    <Frame className="w-[440px]">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <TypeIcon name="mongodb" className="size-6" />
        <span className="font-mono text-base">events</span>
        <span className="ml-auto rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Document</span>
      </div>
      <pre className="px-5 py-4 font-mono text-[15px] leading-[1.9]">
        {"{"}
        {lines.map(([k, v, tone], i) => (
          <div key={k} className="pl-5" style={rise(t, 300 + i * 110, 400, 4)}>
            <span className="text-foreground/80">{k}</span>: <span className={tone}>{v}</span>
          </div>
        ))}
        {"}"}
      </pre>
    </Frame>
  );
}

function SearchCard({ t }: { t: number }) {
  return (
    <Frame className="w-[400px]">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <TypeIcon name="elasticsearch" className="size-6" />
        <span className="font-mono text-base">logs-2026.10</span>
      </div>
      <div className="space-y-2 px-5 py-4 font-mono text-[13px]">
        {["GET /api/orders 200 · 12 ms", "POST /api/pay 201 · 48 ms", "GET /api/users 200 · 9 ms"].map((l, i) => (
          <div key={l} className="rounded border border-border/70 bg-white/[0.02] px-3 py-2 text-foreground/85" style={rise(t, 500 + i * 120, 400, 4)}>
            {l}
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function NoSqlShot() {
  const { t } = useShot();
  return (
    <AbsoluteFill>
      <Camera
        t={t}
        width={1400}
        height={700}
        path={[
          { at: 0, x: 60, y: -10, s: 1.12, ry: 10 },
          { at: 1200, x: 60, y: -10, s: 1.4, ry: 0 },
          { at: 3800, x: 70, y: -10, s: 1.48, ry: -3 },
        ]}
      >
        <div className="absolute" style={{ left: 820, top: 40, ...rise(t, 200, 700, 30) }}>
          <MongoCard t={t} />
        </div>
        <div className="absolute" style={{ left: 900, top: 420, ...rise(t, 400, 700, 30) }}>
          <SearchCard t={t} />
        </div>
        <div className="absolute" style={{ left: 180, top: 160, ...rise(t, 0, 600, 30) }}>
          <RedisCard t={t} />
          <Cursor
            t={t}
            path={[
              { at: 500, x: 420, y: 400 },
              { at: 1000, x: 270, y: 330 },
              { at: 2600, x: 270, y: 330 },
              { at: 3600, x: 420, y: 430 },
            ]}
            clicks={[editAt - 40]}
          />
        </div>
      </Camera>
    </AbsoluteFill>
  );
}
