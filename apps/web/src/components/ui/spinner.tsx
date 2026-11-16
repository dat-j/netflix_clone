import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Đang tải" }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="status" aria-label={label} className={cn("size-6 animate-spin", className)}>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Large brand-coloured spinner for full-page waits (profile switch, title page) */
export function PageSpinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[50vh] items-center justify-center", className)}>
      <Spinner className="size-14 text-brand" />
    </div>
  );
}
