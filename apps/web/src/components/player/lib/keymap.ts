/** Keyboard shortcuts → player commands. Pure mapping, unit-tested. */

export type PlayerCommand =
  | { type: "togglePlay" }
  | { type: "seekBy"; seconds: number }
  | { type: "seekToFraction"; fraction: number }
  | { type: "volumeBy"; delta: number }
  | { type: "toggleMute" }
  | { type: "toggleFullscreen" }
  | { type: "toggleCaptions" }
  | { type: "escape" };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export const SEEK_STEP_SEC = 10;
export const VOLUME_STEP = 0.1;

export function commandForKey(e: KeyLike): PlayerCommand | null {
  // Leave browser/OS shortcuts (Ctrl+R, Cmd+L, Alt+←…) alone
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case " ":
    case "Spacebar":
    case "k":
    case "MediaPlayPause":
      return { type: "togglePlay" };
    case "ArrowLeft":
    case "j":
      return { type: "seekBy", seconds: -SEEK_STEP_SEC };
    case "ArrowRight":
    case "l":
      return { type: "seekBy", seconds: SEEK_STEP_SEC };
    case "ArrowUp":
      return { type: "volumeBy", delta: VOLUME_STEP };
    case "ArrowDown":
      return { type: "volumeBy", delta: -VOLUME_STEP };
    case "m":
      return { type: "toggleMute" };
    case "f":
      return { type: "toggleFullscreen" };
    case "c":
      return { type: "toggleCaptions" };
    case "Escape":
      return { type: "escape" };
    case "Home":
      return { type: "seekToFraction", fraction: 0 };
    default:
      if (/^[0-9]$/.test(key)) return { type: "seekToFraction", fraction: Number(key) / 10 };
      return null;
  }
}

/** Elements where typing must not trigger shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
