import { KeyRound, ShieldCheck, WifiOff } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { easeIn, easeOut, ramp } from "../lib/motion";
import { Kinetic, Pop } from "../ui/kinetic";
import { Logo, TypeIcon } from "../ui/primitives";
import { useShot } from "../ui/stage";

const services = [
  ["postgres", "PostgreSQL"],
  ["mysql", "MySQL / MariaDB"],
  ["clickhouse", "ClickHouse"],
  ["bigquery", "BigQuery"],
  ["snowflake", "Snowflake"],
  ["mongodb", "MongoDB"],
  ["redis", "Redis"],
  ["elasticsearch", "Elasticsearch"],
  ["s3", "S3 / MinIO / R2"],
  ["docker", "Docker"],
];

export function ServicesShot() {
  const { t, dur } = useShot();
  const out = ramp(t, dur - 400, 400, easeIn);
  return (
    <AbsoluteFill className="items-center justify-center" style={{ opacity: 1 - out, filter: out ? `blur(${out * 12}px)` : undefined }}>
      <Pop t={t} at={0} className="text-center font-heading text-[88px] leading-[1.05] font-semibold tracking-tight">
        All your connections. <span className="text-muted-foreground">One place.</span>
      </Pop>
      <div className="mt-20 grid grid-cols-5 gap-x-16 gap-y-12">
        {services.map(([icon, name], i) => {
          const p = ramp(t, 350 + i * 80, 600, easeOut);
          const float = Math.sin(t / 900 - i * 0.7) * 7;
          return (
            <div key={icon} className="flex flex-col items-center gap-4" style={{ opacity: p, transform: `translateY(${(1 - p) * 40 + float}px) scale(${0.7 + 0.3 * p})` }}>
              <span className="relative grid size-[120px] place-items-center rounded-3xl border border-white/10 bg-white/[0.03]">
                <span className="absolute inset-0 rounded-3xl bg-brand/10 blur-2xl" />
                <TypeIcon name={icon} className="relative size-16" />
              </span>
              <span className="text-[22px] text-muted-foreground">{name}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function PrivacyShot() {
  const { t, dur } = useShot();
  const out = ramp(t, dur - 400, 400, easeIn);
  const badges = [
    [KeyRound, "Passwords in your OS keychain"],
    [WifiOff, "No telemetry. No cloud sync."],
    [ShieldCheck, "Read-only AI access over MCP"],
  ] as const;
  const lock = ramp(t, 0, 700, easeOut);
  return (
    <AbsoluteFill className="items-center justify-center" style={{ opacity: 1 - out, filter: out ? `blur(${out * 12}px)` : undefined }}>
      <div className="relative mb-12 grid size-[150px] place-items-center rounded-[36px] border border-brand/40 bg-brand/10" style={{ opacity: lock, transform: `scale(${0.6 + 0.4 * lock})` }}>
        <span className="absolute inset-0 rounded-[36px] bg-brand/20 blur-3xl" />
        <KeyRound className="relative size-[72px] text-brand" />
      </div>
      <Pop t={t} at={200} className="text-center font-heading text-[92px] leading-[1.05] font-semibold tracking-tight">
        Your credentials
        <br />
        <span className="text-muted-foreground">never leave your machine.</span>
      </Pop>
      <div className="mt-14 flex gap-6">
        {badges.map(([Icon, label], i) => (
          <Pop key={label} t={t} at={700 + i * 150} className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3.5 text-[24px] text-foreground/90">
            <Icon className="size-6 text-brand" />
            {label}
          </Pop>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function StackShot() {
  const { t, dur } = useShot();
  const big = "font-heading text-[180px] leading-[0.95] font-extrabold tracking-tight uppercase";
  const small = "font-heading text-[64px] leading-none font-bold tracking-tight uppercase text-muted-foreground";
  return (
    <AbsoluteFill className="items-center justify-center">
      <div className="flex flex-col items-center">
        <Kinetic t={t} dur={dur} delay={500} dist={-260}>
          <span className={small}>Open source</span>
        </Kinetic>
        <Kinetic t={t} dur={dur} delay={0}>
          <span className={big}>Free</span>
        </Kinetic>
        <Kinetic t={t} dur={dur} delay={900} dist={260}>
          <span className={small}>No account. No paywall.</span>
        </Kinetic>
      </div>
    </AbsoluteFill>
  );
}

export function EndCard() {
  const { t } = useShot();
  const logo = ramp(t, 0, 800, easeOut);
  return (
    <AbsoluteFill className="items-center justify-center">
      <AbsoluteFill style={{ background: "radial-gradient(40rem 30rem at center, rgba(107,151,255,0.14), transparent 70%)", opacity: logo }} />
      <div className="flex items-center gap-7" style={{ opacity: logo, transform: `scale(${0.85 + 0.15 * logo})`, filter: logo < 1 ? `blur(${(1 - logo) * 12}px)` : undefined }}>
        <Logo className="size-[150px]" />
        <span className="font-heading text-[136px] leading-none font-semibold tracking-tight">DBDeck</span>
      </div>
      <Pop t={t} at={400} className="mt-8 text-[38px] text-muted-foreground">
        Your databases. Inside your editor.
      </Pop>
      <Pop t={t} at={750} className="mt-14 flex items-center gap-5">
        <span className="rounded-full bg-white px-9 py-4 text-[30px] font-semibold text-black shadow-lg shadow-black/40">Install free at dbdeck.dev</span>
      </Pop>
      <Pop t={t} at={1050} className="mt-10 rounded-xl border border-border bg-black/30 px-6 py-3 font-mono text-[24px] text-foreground/85">
        <span className="text-brand">$</span> code --install-extension dbdeck.dbdeck
      </Pop>
      <Pop t={t} at={1300} className="mt-10 font-mono text-[20px] tracking-[0.3em] text-muted-foreground uppercase">
        VS Code · Cursor · VSCodium · Windsurf
      </Pop>
    </AbsoluteFill>
  );
}
