"use client";

import type { ComponentProps } from "react";

export function SectionLink({ onClick, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const id = props.href?.startsWith("#") ? props.href.slice(1) : null;
        const section = id ? document.getElementById(id) : null;
        if (!section) return;
        event.preventDefault();
        section.scrollIntoView();
      }}
    />
  );
}
