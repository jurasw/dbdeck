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
      <div className="absolute flex flex-col" style={{ left: 56, top: 140, width: 640 }}>
        <div className="flex items-center gap-4">
          <Logo className="size-[68px]" />
          <span className="font-heading text-[54px] leading-none font-semibold tracking-tight">DBDeck</span>
        </div>
        <div className="mt-16 font-heading text-[100px] leading-[0.95] font-extrabold tracking-tight whitespace-nowrap uppercase">
          <div>DB client</div>
          <div className="text-brand">in your IDE</div>
        </div>
        <div className="mt-16 flex items-center gap-[10px]">
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
