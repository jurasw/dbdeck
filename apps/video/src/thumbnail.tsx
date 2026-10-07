import { Sparkles } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { fontVars } from "./lib/fonts";
import { Logo, TypeIcon } from "./ui/primitives";
import { filterAt, Workbench } from "./ui/workbench";
import "./style.css";

const icons = ["postgres", "mysql", "mongodb", "redis", "clickhouse", "bigquery", "snowflake", "elasticsearch", "s3", "docker"];

export function Thumbnail() {
  return (
    <AbsoluteFill style={fontVars} className="overflow-hidden bg-background font-sans">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(48rem 34rem at 82% 40%, rgba(91,140,255,0.32), transparent 62%), radial-gradient(30rem 24rem at 0% 0%, rgba(91,140,255,0.16), transparent 60%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse at 70% 50%, black 20%, transparent 70%)",
        }}
      />
      <div className="absolute" style={{ left: 660, top: 100, perspective: 1600 }}>
        <div style={{ transform: "rotateY(-16deg) rotateX(6deg) scale(1.02)", transformOrigin: "left center" }}>
          <Workbench scene="filter" t={filterAt.generated + 600} />
        </div>
      </div>
      <div className="absolute flex items-center gap-2 rounded-full border border-brand/50 bg-[#16203a] px-5 py-2.5 text-[26px] font-semibold text-brand shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)]" style={{ left: 770, top: 48 }}>
        <Sparkles className="size-7" />
        AI → SQL
      </div>
      <div className="absolute flex flex-col" style={{ left: 56, top: 52, width: 620 }}>
        <div className="flex items-center gap-4">
          <Logo className="size-[68px]" />
          <span className="font-heading text-[54px] leading-none font-semibold tracking-tight">DBDeck</span>
        </div>
        <div className="mt-9 font-heading text-[94px] leading-[0.94] font-extrabold tracking-tight uppercase">
          <div>All your</div>
          <div>databases</div>
          <div className="text-brand">in VS Code</div>
        </div>
        <div className="mt-8 flex items-center gap-3">
          <span className="rounded-xl bg-emerald-400 px-5 py-2 text-[38px] font-extrabold tracking-tight text-black uppercase">Free</span>
          <span className="rounded-xl border-2 border-white/80 px-4 py-1.5 text-[30px] font-bold tracking-tight uppercase">Open source</span>
        </div>
        <div className="mt-9 flex items-center gap-[10px]">
          {icons.map((name) => (
            <span key={name} className="grid size-[46px] place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <TypeIcon name={name} className="size-[26px]" />
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}
