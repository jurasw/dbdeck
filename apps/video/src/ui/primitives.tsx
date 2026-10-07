import { Img, staticFile, useCurrentFrame } from "remotion";
import { cn } from "../lib/cn";
import { ms } from "../lib/motion";

export function Caret() {
  const t = ms(useCurrentFrame());
  return (
    <span
      aria-hidden
      className="ml-px inline-block h-[1.1em] w-px translate-y-[2px] bg-foreground"
      style={{ opacity: Math.floor(t / 450) % 2 ? 0.25 : 1 }}
    />
  );
}

export function Frame({ className, style, children }: { className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div
      className={cn("overflow-hidden rounded-2xl border border-border bg-[#141a29] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)]", className)}
      style={style}
    >
      {children}
    </div>
  );
}

export function FrameChrome({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between gap-4 border-b border-border bg-black/20 px-4 font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
      <span className="inline-flex min-w-0 items-center gap-2 truncate">
        <span aria-hidden className="inline-flex gap-1.5">
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
          <span className="size-2 rounded-full bg-white/15" />
        </span>
        <span className="truncate">{left}</span>
      </span>
      {right && <span className="inline-flex shrink-0 items-center gap-2">{right}</span>}
    </div>
  );
}

export function Kbd({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <kbd
      className={cn("whitespace-nowrap rounded border border-border bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground", className)}
      style={style}
    >
      {children}
    </kbd>
  );
}

export function TypeIcon({ name, className }: { name: string; className?: string }) {
  return <Img src={staticFile(`types/${name}-on.svg`)} className={className} />;
}

export function Logo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <Img src={staticFile("icon.svg")} className={className} style={style} />;
}

export function Btn({
  children,
  pressed,
  primary,
  className,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[10.5px]",
        primary ? "border-transparent bg-white font-medium text-black" : "border-border bg-white/[0.03] text-foreground/80",
        pressed && "scale-90 ring-2 ring-brand",
        className,
      )}
    >
      {children}
    </span>
  );
}
