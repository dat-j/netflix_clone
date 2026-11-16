/** Static black stage + spinner shown while the route streams in (no client JS needed). */
export function PlayerShell() {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black" aria-busy="true">
      <div role="status" aria-label="Đang tải" className="relative size-16 md:size-20">
        <div className="absolute inset-0 rounded-full border-[5px] border-white/15" />
        <div className="absolute inset-0 animate-spin rounded-full border-[5px] border-transparent border-t-[var(--brand,#e50914)] [animation-duration:0.8s]" />
      </div>
    </div>
  );
}
