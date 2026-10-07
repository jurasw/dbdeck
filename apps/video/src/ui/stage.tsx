import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { easeIn, easeOut, keys, ms, ramp, type Key } from "../lib/motion";

export function Backdrop() {
  const t = ms(useCurrentFrame());
  const drift = t / 120;
  return (
    <AbsoluteFill className="bg-background">
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70rem 45rem at 18% -12%, rgba(91,140,255,0.16), transparent 60%), radial-gradient(50rem 40rem at 92% 110%, rgba(91,140,255,0.08), transparent 60%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          backgroundPosition: `${drift}px ${drift * 0.6}px`,
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
}

export function useShot() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return { t: ms(frame), dur: ms(durationInFrames) };
}

export function Shot({ children, enter = 450, exit = 400, from = 0.94, to = 1.05 }: { children: React.ReactNode; enter?: number; exit?: number; from?: number; to?: number }) {
  const { t, dur } = useShot();
  const a = enter ? ramp(t, 0, enter, easeOut) : 1;
  const b = exit ? ramp(t, dur - exit, exit, easeIn) : 0;
  const scale = (from + (1 - from) * a) * (1 + (to - 1) * b);
  const blur = (1 - a) * 18 + b * 18;
  return (
    <AbsoluteFill style={{ opacity: a * (1 - b), transform: `scale(${scale})`, filter: blur > 0.1 ? `blur(${blur}px)` : undefined }}>
      {children}
    </AbsoluteFill>
  );
}

export type CamKey = Key & { x: number; y: number; s: number; rx?: number; ry?: number };

export function Camera({ t, path, children, width, height }: { t: number; path: CamKey[]; children: React.ReactNode; width: number; height: number }) {
  const x = keys(t, path, "x");
  const y = keys(t, path, "y");
  const s = keys(t, path, "s");
  const rx = keys(t, path, "rx");
  const ry = keys(t, path, "ry");
  return (
    <AbsoluteFill className="items-center justify-center" style={{ perspective: 2400 }}>
      <div
        style={{
          width,
          height,
          transform: `scale(${s}) rotateX(${rx || 0}deg) rotateY(${ry || 0}deg) translate(${-x}px, ${-y}px)`,
          transformStyle: "preserve-3d",
          position: "relative",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}
