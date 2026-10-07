"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ editor, icon, command }: { editor: string; icon: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-black/30 p-3 transition-colors hover:border-border/80 hover:bg-card/70">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" width={24} height={24} className="size-6 object-contain" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-foreground">{editor}</span>
        <code className="mt-0.5 block overflow-x-auto font-mono text-[11px] whitespace-nowrap text-muted-foreground sm:text-xs">{command}</code>
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${editor} command copied` : `Copy ${editor} install command`}
        title={copied ? "Copied" : `Copy ${editor} install command`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
      >
        {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
