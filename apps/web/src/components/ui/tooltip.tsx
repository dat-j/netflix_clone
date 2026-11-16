"use client";

import { Tooltip as RTooltip } from "radix-ui";
import type { ReactNode } from "react";

/** Netflix-style white tooltip with arrow, used on circular action buttons. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={8}
          className="z-[90] rounded bg-[#e6e6e6] px-3 py-1.5 text-[0.95rem] font-semibold text-black shadow-lg data-[state=delayed-open]:animate-fade-in"
        >
          {content}
          <RTooltip.Arrow className="fill-[#e6e6e6]" width={12} height={6} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
