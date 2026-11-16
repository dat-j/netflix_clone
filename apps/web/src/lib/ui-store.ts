"use client";

import type { TitleCard } from "@app/shared";
import { create } from "zustand";

export type HoverAlign = "left" | "center" | "right";

export interface HoverTarget {
  card: TitleCard;
  /** Element rect in viewport coordinates at the moment the preview opened */
  rect: { top: number; left: number; width: number; height: number };
  align: HoverAlign;
  /** unique per card instance (row + index) so the same title in two rows is distinct */
  key: string;
  variant: "default" | "top10" | "continue";
}

interface UIState {
  hover: HoverTarget | null;
  openHover: (t: HoverTarget) => void;
  closeHover: (key?: string) => void;
  /** Preview audio preference, shared by billboard, hover card and modal */
  muted: boolean;
  setMuted: (m: boolean) => void;
  /** Something else is playing a preview (hover card / modal) — billboard should pause */
  previewOwner: string | null;
  setPreviewOwner: (owner: string | null) => void;
}

function readMuted() {
  try {
    return typeof window === "undefined" ? true : window.localStorage.getItem("lm_preview_muted") !== "0";
  } catch {
    return true;
  }
}

export const useUI = create<UIState>((set, get) => ({
  hover: null,
  openHover: (t) => set({ hover: t }),
  closeHover: (key) => {
    if (!key || get().hover?.key === key) set({ hover: null });
  },
  muted: true,
  setMuted: (muted) => {
    try {
      window.localStorage.setItem("lm_preview_muted", muted ? "1" : "0");
    } catch {}
    set({ muted });
  },
  previewOwner: null,
  setPreviewOwner: (previewOwner) => set({ previewOwner }),
}));

/** Hydrate the persisted mute preference after mount (avoids SSR mismatch) */
export function hydrateUIPrefs() {
  useUI.setState({ muted: readMuted() });
}
