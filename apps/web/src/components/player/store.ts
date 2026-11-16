"use client";

import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { initialPlayerState, playerReducer, type PlayerAction, type PlayerState } from "./lib/state";

export type MenuId = "audio" | "speed" | "quality" | "volume" | null;

export type FeedbackKind = "play" | "pause" | "back" | "forward" | "volume" | "mute";

export interface Feedback {
  kind: FeedbackKind;
  /** Bumped on every trigger so repeated actions re-animate */
  id: number;
  /** For seeks: which side; for volume: % */
  side?: "left" | "right" | "center";
  value?: number;
}

interface UiSlice {
  chromeVisible: boolean;
  menu: MenuId;
  feedback: Feedback | null;
  fullscreen: boolean;
  pip: boolean;
  /** Seconds accumulated by consecutive double-tap seeks (shown in the ripple) */
  seekStreak: number;
  /** Current subtitle language (null = off) */
  subtitleLang: string | null;
}

export interface PlayerStoreState extends PlayerState, UiSlice {
  dispatch: (action: PlayerAction) => void;
  setUi: (patch: Partial<UiSlice>) => void;
  pushFeedback: (f: Omit<Feedback, "id">) => void;
}

let feedbackSeq = 0;

export function createPlayerStore(prefs?: Partial<Pick<PlayerState, "volume" | "muted" | "rate">> & { subtitleLang?: string | null }) {
  return createStore<PlayerStoreState>((set) => ({
    ...initialPlayerState(prefs),
    chromeVisible: true,
    menu: null,
    feedback: null,
    fullscreen: false,
    pip: false,
    seekStreak: 0,
    subtitleLang: prefs?.subtitleLang ?? null,
    dispatch: (action) =>
      set((s) => {
        const next = playerReducer(s, action);
        return next === s ? s : { ...s, ...next };
      }),
    setUi: (patch) => set(patch),
    pushFeedback: (f) => set({ feedback: { ...f, id: ++feedbackSeq } }),
  }));
}

export type PlayerStore = StoreApi<PlayerStoreState>;

export const PlayerStoreContext = createContext<PlayerStore | null>(null);

export function usePlayerStore<T>(selector: (s: PlayerStoreState) => T): T {
  const store = useContext(PlayerStoreContext);
  if (!store) throw new Error("usePlayerStore must be used inside <PlayerStoreContext>");
  return useStore(store, selector);
}

export function usePlayerStoreApi(): PlayerStore {
  const store = useContext(PlayerStoreContext);
  if (!store) throw new Error("usePlayerStoreApi must be used inside <PlayerStoreContext>");
  return store;
}
