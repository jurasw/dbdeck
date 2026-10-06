import Link from "next/link";
import { cn } from "@/lib/utils";

export const links = {
  github: "https://github.com/jurasw/dbdeck",
  issues: "https://github.com/jurasw/dbdeck/issues/new/choose",
  releases: "https://github.com/jurasw/dbdeck/releases/latest",
  changelog: "https://github.com/jurasw/dbdeck/blob/main/apps/extension/CHANGELOG.md",
  marketplace: "https://marketplace.visualstudio.com/items?itemName=dbdeck.dbdeck",
  openVsx: "https://open-vsx.org/extension/dbdeck/dbdeck",
};

export function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6", className)}>{children}</div>;
}

export function Pin() {
  return <span aria-hidden className="inline-block size-1 rounded-full bg-brand align-middle" />;
}

export function PrimaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-black/40 transition-all duration-300 hover:bg-neutral-100 hover:shadow-xl [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:translate-x-0.5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-black/10 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </Link>
  );
}

export function GhostCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-5 py-2.5 text-sm text-foreground backdrop-blur-sm transition-colors hover:border-foreground/20 hover:bg-card"
    >
      {children}
    </a>
  );
}

export function SoftDivider() {
  return (
    <div className="mx-auto my-24 max-w-6xl px-6">
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </div>
  );
}

export function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card/50 shadow-2xl shadow-black/50 backdrop-blur-sm",
        className,
      )}
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
      {right && <span className="hidden shrink-0 items-center gap-2 sm:inline-flex">{right}</span>}
    </div>
  );
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 font-mono text-[10px] tracking-[0.25em] text-muted-foreground/80 uppercase">{children}</div>;
}

export function Screenshot({ src, alt, chrome, caption }: { src: string; alt: string; chrome: string; caption: string }) {
  return (
    <figure>
      <Frame>
        <FrameChrome left={chrome} right={<span className="text-brand">live</span>} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={1920} height={1200} loading="lazy" className="block h-auto w-full" />
      </Frame>
      <figcaption>
        <Caption>{caption}</Caption>
      </figcaption>
    </figure>
  );
}

export function Heading({ lead, rest }: { lead: string; rest: string }) {
  return (
    <h2 className="font-heading text-3xl leading-[1.08] font-semibold tracking-tight text-balance md:text-5xl">
      <span className="text-foreground">{lead}</span> <span className="text-muted-foreground">{rest}</span>
    </h2>
  );
}

export function Lede({ children }: { children: React.ReactNode }) {
  return <p className="mt-7 max-w-md text-base leading-[1.75] text-muted-foreground">{children}</p>;
}

export function SmallList({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 space-y-2.5 font-mono text-[12.5px] text-foreground/80">
      {items.map((item) => (
        <li key={item} className="flex items-baseline gap-3">
          <span aria-hidden className="text-brand">
            →
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="whitespace-nowrap rounded border border-border bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{children}</kbd>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
