import { cn } from "@/lib/utils";

/**
 * Decorative, asset-free "wall of posters" used behind the landing hero and auth screens.
 * Deterministic gradients so server and client render identically.
 */
const PALETTE = [
  ["#3a1c71", "#d76d77"],
  ["#0f2027", "#2c5364"],
  ["#42275a", "#734b6d"],
  ["#1d2b64", "#f8cdda"],
  ["#232526", "#414345"],
  ["#614385", "#516395"],
  ["#5a3f37", "#2c7744"],
  ["#141e30", "#243b55"],
  ["#c04848", "#480048"],
  ["#283c86", "#45a247"],
  ["#4b134f", "#c94b4b"],
  ["#1f1c2c", "#928dab"],
  ["#ff5a3c", "#7a1f10"],
  ["#0b486b", "#f56217"],
] as const;

function tile(i: number) {
  const [a, b] = PALETTE[(i * 7 + 3) % PALETTE.length];
  const angle = (i * 47) % 360;
  const glow = (i * 29) % 100;
  return {
    background: `radial-gradient(120% 80% at ${glow}% 10%, rgb(255 255 255 / 0.18), transparent 55%), linear-gradient(${angle}deg, ${a}, ${b})`,
  };
}

export function PosterWall({ className, intensity = "hero" }: { className?: string; intensity?: "hero" | "auth" }) {
  const cols = 9;
  const rows = 5;
  return (
    <div aria-hidden className={cn("absolute inset-0 overflow-hidden bg-black", className)}>
      <div
        className="absolute top-1/2 left-1/2 grid w-[150vw] min-w-[1400px] -translate-x-1/2 -translate-y-1/2 -rotate-[8deg] gap-3 opacity-90 motion-safe:animate-[poster-drift_18s_ease-in-out_infinite_alternate]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols * rows }, (_, i) => (
          <div key={i} className="relative aspect-[2/3] overflow-hidden rounded-md shadow-lg shadow-black/50 transition-transform duration-700 hover:scale-[1.03]" style={tile(i)}>
            <div className="absolute inset-x-[12%] bottom-[10%] space-y-1.5">
              <div className="h-[6px] w-3/4 rounded-full bg-white/35" />
              <div className="h-[4px] w-1/2 rounded-full bg-white/20" />
            </div>
          </div>
        ))}
      </div>
      <div
        className={cn(
          "absolute inset-0",
          intensity === "hero"
            ? "bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.55)_0%,rgb(0_0_0/0.8)_70%),linear-gradient(180deg,rgb(0_0_0/0.85)_0%,rgb(0_0_0/0.3)_35%,rgb(0_0_0/0.6)_70%,#000_100%)]"
            : "bg-black/65",
        )}
      />
    </div>
  );
}
