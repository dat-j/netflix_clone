import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Brand mark: a light-beam "L" with a play notch. Colours come from the --brand token. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-[1em] shrink-0", className)}>
      <path d="M7 4h6v18h12v6H7z" fill="var(--brand)" />
      <path d="M16 9l9 5.2-9 5.2z" fill="currentColor" />
    </svg>
  );
}

/** Text wordmark rendered from BRAND.name (no external logo assets to swap). */
export function Wordmark({ className, withMark = true }: { className?: string; withMark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.18em] font-black leading-none tracking-[-0.04em] text-brand uppercase select-none",
        className,
      )}
    >
      {withMark && <LogoMark className="text-white" />}
      <span className="bg-gradient-to-b from-[var(--brand-hover)] to-[var(--brand)] bg-clip-text text-transparent">{BRAND.name}</span>
    </span>
  );
}

export function LogoLink({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label={`${BRAND.name} – Trang chủ`} className={cn("inline-flex rounded-sm", className)}>
      <Wordmark className="text-[1.75rem] md:text-[2rem]" />
    </Link>
  );
}
