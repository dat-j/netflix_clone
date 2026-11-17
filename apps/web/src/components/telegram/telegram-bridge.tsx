"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { loadTelegram, useTelegram } from "@/lib/telegram";

/** Top-level screens of the Mini App: Telegram shows its own close button there instead of Back. */
const ROOTS = new Set(["/tg", "/browse", "/profiles"]);

/**
 * Mounted once in the root providers. Outside Telegram it does nothing (no SDK download).
 * Inside the Mini App: drives Telegram's native BackButton from the current route and keeps vertical swipes
 * (swipe-down-to-close) off while the player is open so scrubbing/gestures don't minimise the app.
 */
export function TelegramBridge() {
  const wa = useTelegram();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void loadTelegram();
  }, []);

  useEffect(() => {
    if (!wa) return;
    const back = wa.BackButton;
    const onBack = () => {
      const nav = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
      const canGoBack = nav?.canGoBack ?? window.history.length > 1;
      if (canGoBack) router.back();
      else router.replace("/browse");
    };
    if (ROOTS.has(pathname)) {
      back.hide();
      return;
    }
    back.onClick(onBack);
    back.show();
    return () => {
      back.offClick(onBack);
    };
  }, [wa, pathname, router]);

  useEffect(() => {
    if (!wa) return;
    const watching = pathname.startsWith("/watch/");
    // Fullscreen is only requested by the player; leave it when navigating away (e.g. via Telegram's Back)
    if (!watching && wa.isFullscreen) wa.exitFullscreen?.();
    if (!wa.isVersionAtLeast("7.7")) return;
    if (watching) wa.disableVerticalSwipes?.();
    else wa.enableVerticalSwipes?.();
  }, [wa, pathname]);

  return null;
}
