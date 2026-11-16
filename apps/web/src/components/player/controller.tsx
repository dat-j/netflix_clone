"use client";

import type { PlaybackSession, TitleDetail } from "@app/shared";
import { createContext, useContext } from "react";
import type { PlayerEngine } from "./engine";
import type { MenuId } from "./store";
import type { ThumbnailCue } from "./lib/vtt";

export interface PlayerController {
  engine: () => PlayerEngine | null;
  togglePlay: (withFeedback?: boolean) => void;
  play: () => void;
  seek: (time: number) => void;
  seekBy: (delta: number, feedback?: "left" | "right" | "center" | false) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  setLevel: (index: number) => void;
  setAudioTrack: (id: number) => void;
  setSubtitle: (lang: string | null) => void;
  toggleFullscreen: () => void;
  togglePip: () => void;
  goBack: () => void;
  replay: () => void;
  poke: () => void;
  setMenu: (m: MenuId) => void;
  session: PlaybackSession | null;
  detail: TitleDetail | null;
  thumbnails: ThumbnailCue[];
  canPip: boolean;
  canFullscreen: boolean;
  /** Coarse pointer (touch) layout */
  touch: boolean;
  nextEpisodeHref: string | null;
}

export const PlayerControllerContext = createContext<PlayerController | null>(null);

export function usePlayer(): PlayerController {
  const c = useContext(PlayerControllerContext);
  if (!c) throw new Error("usePlayer must be used inside the player");
  return c;
}
