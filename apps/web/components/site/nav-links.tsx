"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const items = [
  { id: "features", label: "Features" },
  { id: "install", label: "Install" },
  { id: "faq", label: "FAQ" },
];

export function NavLinks() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current: string | null = null;
      for (const { id } of items) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return items.map(({ id, label }) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={active === id ? "true" : undefined}
      className={cn(
        "hidden rounded-full px-3 py-1.5 transition-colors hover:text-foreground sm:inline",
        active === id && "bg-card text-foreground",
      )}
    >
      {label}
    </a>
  ));
}
