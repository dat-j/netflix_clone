"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  size?: "md" | "lg";
  active?: boolean;
}

/**
 * Icon button for the player chrome: big hit target, scale-up on hover (Netflix feel),
 * tooltip-less (the aria-label is the name; `title` gives mouse users a hint).
 */
export const ControlButton = forwardRef<HTMLButtonElement, Props>(function ControlButton(
  { label, children, className, size = "md", active, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full text-white transition-transform duration-150 ease-out outline-none",
        "hover:scale-[1.18] focus-visible:scale-[1.1] focus-visible:ring-2 focus-visible:ring-white active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100",
        size === "lg" ? "size-12 [&>svg]:size-9 lg:size-14 lg:[&>svg]:size-10" : "size-11 [&>svg]:size-7 lg:size-12 lg:[&>svg]:size-8",
        active && "text-[var(--brand,#e50914)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
