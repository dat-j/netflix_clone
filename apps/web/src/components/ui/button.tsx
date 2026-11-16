import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

const variants = {
  /** Brand CTA (sign in, sign up, plan CTAs) */
  brand: "bg-brand text-brand-ink hover:bg-brand-hover",
  /** White "Play" button */
  primary: "bg-white text-black hover:bg-white/75",
  /** Translucent grey "More info" button */
  secondary: "bg-[rgb(109_109_110/0.7)] text-white hover:bg-[rgb(109_109_110/0.4)]",
  outline: "border border-white/40 bg-transparent text-white/90 hover:border-white hover:text-white",
  ghost: "bg-transparent text-white/80 hover:bg-white/10 hover:text-white",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
} as const;

const sizes = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-[0.95rem]",
  lg: "h-12 gap-2.5 px-6 text-lg",
  xl: "h-14 gap-3 px-7 text-xl",
  icon: "size-10",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, asChild, className, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner className="size-[1.1em]" />}
          {children}
        </>
      )}
    </Comp>
  );
});

/** Round icon buttons used on cards and the detail modal (add to list, rate, expand…) */
export const CircleButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "outline" | "solid" }>(
  function CircleButton({ className, tone = "outline", ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex aspect-square shrink-0 items-center justify-center rounded-full transition-colors duration-150",
          tone === "solid"
            ? "bg-white text-black hover:bg-white/80"
            : "border-2 border-white/50 bg-[#2a2a2a]/60 text-white hover:border-white",
          className,
        )}
        {...props}
      />
    );
  },
);
