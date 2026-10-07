import { AbsoluteFill } from "remotion";
import { easeIn, easeOut, ramp } from "../lib/motion";
import { Pop } from "../ui/kinetic";
import { Logo } from "../ui/primitives";
import { useShot } from "../ui/stage";

export function Reveal() {
  const { t, dur } = useShot();
  const flash = 1 - ramp(t, 0, 500, easeOut);
  const logo = ramp(t, 0, 700, easeOut);
  const up = ramp(t, 1100, 700);
  const out = ramp(t, dur - 450, 450, easeIn);
  return (
    <AbsoluteFill className="items-center justify-center">
      <AbsoluteFill style={{ background: `radial-gradient(circle at center, rgba(107,151,255,${0.55 * flash}), transparent ${30 + 50 * (1 - flash)}%)` }} />
      <div className="flex flex-col items-center" style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.08})`, filter: out > 0 ? `blur(${out * 14}px)` : undefined }}>
        <div className="flex items-center gap-7" style={{ transform: `translateY(${-up * 40}px) scale(${1 - up * 0.42})` }}>
          <div className="relative" style={{ transform: `scale(${0.4 + 0.6 * logo}) rotate(${(1 - logo) * -25}deg)`, opacity: logo }}>
            <div className="absolute -inset-10 rounded-full bg-brand/30 blur-3xl" style={{ opacity: 0.4 + 0.6 * flash }} />
            <Logo className="relative size-[180px]" />
          </div>
          <span
            className="font-heading text-[150px] leading-none font-semibold tracking-tight"
            style={{ opacity: ramp(t, 250, 500), transform: `translateX(${(1 - ramp(t, 250, 700)) * -40}px)`, filter: `blur(${(1 - ramp(t, 250, 500)) * 10}px)` }}
          >
            DBDeck
          </span>
        </div>
        <div className="mt-2 flex flex-col items-center text-center font-heading text-[104px] leading-[1.02] font-semibold tracking-tight">
          <Pop t={t} at={1250}>Your databases.</Pop>
          <Pop t={t} at={1550} className="text-muted-foreground">
            Inside your editor.
          </Pop>
        </div>
        <Pop t={t} at={2000} className="mt-10 text-[34px] text-muted-foreground">
          Free, open source database client for VS Code and Cursor.
        </Pop>
      </div>
    </AbsoluteFill>
  );
}
