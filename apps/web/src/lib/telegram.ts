"use client";

/**
 * Telegram Mini App bridge (https://core.telegram.org/bots/webapps).
 *
 * The official SDK script is only loaded when the page is (or was, in this tab) opened as a Mini App:
 * - `/tg` loads it unconditionally;
 * - every other page loads it when Telegram's launch params are present (URL hash `tgWebAppData`, or the SDK's own
 *   sessionStorage copy after a reload), so a full page reload inside the Mini App keeps Telegram mode.
 * Normal website visitors never download it.
 */
import { useSyncExternalStore } from "react";
import { MINI_APP_DEFAULT_PATH, sanitizeMiniAppPath } from "@app/shared";

export const TELEGRAM_SDK_URL = "https://telegram.org/js/telegram-web-app.js";
/** Bot username (without @), overridable with NEXT_PUBLIC_TELEGRAM_BOT_USERNAME */
export const TELEGRAM_BOT_USERNAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "boxphim_bot").replace(/^@/, "");
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
/** Marker so a full reload inside the Mini App knows to boot the SDK again */
const SESSION_FLAG = "bp_tg";

type Handler = (...args: unknown[]) => void;

export interface TelegramBackButton {
  isVisible: boolean;
  show(): TelegramBackButton;
  hide(): TelegramBackButton;
  onClick(cb: () => void): TelegramBackButton;
  offClick(cb: () => void): TelegramBackButton;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string }; start_param?: string };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Partial<Record<"bg_color" | "text_color" | "hint_color" | "link_color" | "button_color" | "button_text_color" | "secondary_bg_color", string>>;
  isExpanded: boolean;
  isFullscreen?: boolean;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
  onEvent(event: string, cb: Handler): void;
  offEvent(event: string, cb: Handler): void;
  BackButton: TelegramBackButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

// ───────── state ─────────
let current: TelegramWebApp | null = null;
const listeners = new Set<() => void>();
function setCurrent(wa: TelegramWebApp | null) {
  current = wa;
  if (typeof document !== "undefined") {
    if (wa) document.documentElement.dataset.tg = wa.platform || "1";
    else delete document.documentElement.dataset.tg;
  }
  for (const l of listeners) l();
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The Mini App WebApp object when running inside Telegram with launch data, else null. */
export function getTelegram(): TelegramWebApp | null {
  if (current) return current;
  if (typeof window === "undefined") return null;
  const wa = window.Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

export const isInTelegram = () => getTelegram() !== null;

/** React hook: the Mini App object (null on the server, on first render and outside Telegram). */
export function useTelegram(): TelegramWebApp | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

function hasLaunchParams(): boolean {
  try {
    if (window.location.hash.includes("tgWebAppData")) return true;
    if (window.sessionStorage.getItem(SESSION_FLAG) === "1") return true;
    return window.sessionStorage.getItem("__telegram__initParams") !== null;
  } catch {
    return false;
  }
}

let loading: Promise<TelegramWebApp | null> | null = null;

/** Load the SDK once (resolves null outside Telegram or if the script cannot load within a few seconds). */
export function loadTelegram(force = false): Promise<TelegramWebApp | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (current) return Promise.resolve(current);
  if (!force && !hasLaunchParams()) return Promise.resolve(null);
  loading ??= new Promise<TelegramWebApp | null>((resolve) => {
    const done = () => {
      const wa = window.Telegram?.WebApp;
      resolve(wa && wa.initData ? wa : null);
    };
    if (window.Telegram?.WebApp) return done();
    const script = document.createElement("script");
    script.src = TELEGRAM_SDK_URL;
    script.async = true;
    const timer = setTimeout(done, 6000);
    script.onload = () => {
      clearTimeout(timer);
      done();
    };
    script.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  }).then((wa) => {
    if (wa) initMiniApp(wa);
    else loading = null;
    return wa;
  });
  return loading;
}

const BRAND_BG = "#141414";

function initMiniApp(wa: TelegramWebApp) {
  try {
    window.sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    /* storage blocked */
  }
  try {
    wa.ready();
    wa.expand();
    // The product UI is always dark: paint Telegram's chrome with our background instead of the user's theme,
    // so the header/bottom bar blend with the page. Older clients without these methods simply ignore it.
    if (wa.isVersionAtLeast("6.1")) {
      wa.setHeaderColor?.(BRAND_BG);
      wa.setBackgroundColor?.(BRAND_BG);
    }
    if (wa.isVersionAtLeast("7.10")) wa.setBottomBarColor?.(BRAND_BG);
    // Theme accent where it fits: only the link colour (used for small inline links in Mini App screens)
    if (wa.themeParams.link_color && wa.colorScheme === "dark") {
      document.documentElement.style.setProperty("--tg-link", wa.themeParams.link_color);
    }
  } catch {
    /* never let an SDK quirk break the page */
  }
  setCurrent(wa);
}

// ───────── helpers ─────────
export function canTelegramFullscreen(wa: TelegramWebApp | null = getTelegram()): wa is TelegramWebApp & Required<Pick<TelegramWebApp, "requestFullscreen" | "exitFullscreen">> {
  return !!wa && typeof wa.requestFullscreen === "function" && wa.isVersionAtLeast("8.0");
}

/** Where to send a user whose session is gone: inside Telegram we can silently sign in again via initData. */
export function reauthUrl(here: string): string | null {
  if (!isInTelegram()) return null;
  return miniAppEntry(here);
}

/** `/tg?to=<path>` for an in-app path (sanitised: unknown paths fall back to /browse). */
export function miniAppEntry(to?: string | null): string {
  const safe = sanitizeMiniAppPath(to);
  return safe === MINI_APP_DEFAULT_PATH && !to ? "/tg" : `/tg?to=${encodeURIComponent(safe)}`;
}

/** Open a URL outside the Mini App (system browser) when possible. */
export function openExternal(url: string) {
  const wa = getTelegram();
  if (wa?.openLink) wa.openLink(url);
  else window.open(url, "_blank", "noopener");
}
