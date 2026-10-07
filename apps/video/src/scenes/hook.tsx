import { AbsoluteFill } from "remotion";
import { easeIn, easeOut, ramp } from "../lib/motion";
import { Kinetic } from "../ui/kinetic";
import { TypeIcon } from "../ui/primitives";
import { useShot } from "../ui/stage";

const messages = [
  { who: "Kasia", tone: "#f472b6", text: "where's the staging DB password?", x: -480, y: -330, at: 0 },
  { who: "Marek", tone: "#34d399", text: "which app opens Redis again?", x: 470, y: -250, at: 180 },
  { who: "Ola", tone: "#fbbf24", text: "can someone send me the prod Mongo URL?", x: -430, y: -20, at: 360 },
  { who: "Tom", tone: "#60a5fa", text: "what client do we use for ClickHouse?", x: 520, y: 70, at: 520 },
  { who: "Anna", tone: "#c084fc", text: "my database app trial just expired", x: -420, y: 300, at: 680 },
  { who: "Piotr", tone: "#f87171", text: "S3 keys are in some doc somewhere", x: 450, y: 360, at: 820 },
];

const icons = [
  { name: "postgres", x: -250, y: -420 },
  { name: "mongodb", x: 820, y: -220 },
  { name: "redis", x: -840, y: -180 },
  { name: "mysql", x: 140, y: 420 },
  { name: "elasticsearch", x: -820, y: 260 },
  { name: "clickhouse", x: 230, y: -440 },
  { name: "s3", x: 840, y: 180 },
  { name: "snowflake", x: -120, y: 440 },
  { name: "bigquery", x: 760, y: 420 },
  { name: "docker", x: -700, y: -420 },
];

function Bubble({ who, tone, text }: { who: string; tone: string; text: string }) {
  return (
    <div className="flex items-center gap-4 rounded-[22px] border border-white/10 bg-white px-5 py-4 shadow-[0_24px_70px_-10px_rgba(0,0,0,0.65)]">
      <span className="grid size-13 shrink-0 place-items-center rounded-full text-[22px] font-bold text-white" style={{ background: tone }}>
        {who[0]}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[19px] leading-tight font-semibold text-neutral-900">{who}</span>
        <span className="text-[25px] leading-tight whitespace-nowrap text-neutral-600">{text}</span>
      </span>
    </div>
  );
}

export function Hook() {
  const { t, dur } = useShot();
  const textAt = 1900;
  const back = ramp(t, textAt - 200, 600, easeOut);
  const collapse = ramp(t, dur - 520, 520, easeIn);
  return (
    <AbsoluteFill className="items-center justify-center overflow-hidden">
      {icons.map((ic, i) => {
        const p = ramp(t, 100 + i * 70, 700);
        const float = Math.sin(t / 700 + i) * 8;
        return (
          <div
            key={ic.name}
            className="absolute"
            style={{
              transform: `translate(${ic.x * (1 - collapse)}px, ${ic.y * (1 - collapse) + float}px) scale(${(0.6 + 0.4 * p) * (1 - collapse * 0.7)})`,
              opacity: p * (1 - back * 0.65) * (1 - collapse),
              filter: `blur(${back * 4}px)`,
            }}
          >
            <TypeIcon name={ic.name} className="size-14" />
          </div>
        );
      })}
      {messages.map((m, i) => {
        const p = ramp(t, m.at, 550, easeOut);
        const drift = t / 1000;
        const float = Math.sin(t / 900 + i * 1.7) * 6;
        const sx = m.x * (1 - collapse);
        const sy = (m.y + float) * (1 - collapse);
        return (
          <div
            key={m.who}
            className="absolute"
            style={{
              transform: `translate(${sx + (1 - p) * (m.x > 0 ? 80 : -80)}px, ${sy + (1 - p) * 30}px) scale(${(0.85 + 0.15 * p + drift * 0.03) * (1 - back * 0.12) * (1 - collapse * 0.8)})`,
              opacity: p * (1 - back * 0.6) * (1 - collapse),
              filter: `blur(${back * 5 + collapse * 8}px)`,
            }}
          >
            <Bubble {...m} />
          </div>
        );
      })}
      <AbsoluteFill className="items-center justify-center">
        <Kinetic t={t} dur={dur} delay={textAt} exit={420}>
          <span className="font-heading text-[150px] leading-none font-extrabold tracking-tight text-foreground uppercase">Tired of this?</span>
        </Kinetic>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
