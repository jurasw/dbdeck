import type { LucideIcon } from "lucide-react";
import { AbsoluteFill } from "remotion";
import { Kinetic } from "../ui/kinetic";
import { Sfx } from "../ui/sfx";
import { useShot } from "../ui/stage";

export function TitleCard({ icon: Icon, title, kicker }: { icon: LucideIcon; title: string; kicker?: string }) {
  const { t, dur } = useShot();
  return (
    <AbsoluteFill className="items-center justify-center" style={{ transform: `scale(${1 + (t / dur) * 0.06})` }}>
      <Kinetic t={t} dur={dur} className="flex flex-col items-center">
        <div className="flex items-center gap-6">
          <Icon className="size-[92px] text-brand" strokeWidth={2.4} />
          <span className="font-heading text-[128px] leading-none font-extrabold tracking-tight text-foreground uppercase">{title}</span>
        </div>
        {kicker && <span className="mt-6 font-mono text-[26px] tracking-[0.3em] text-muted-foreground uppercase">{kicker}</span>}
      </Kinetic>
      <Sfx name="swish" at={0} volume={0.22} />
    </AbsoluteFill>
  );
}
