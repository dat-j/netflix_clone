"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Tooltip } from "radix-ui";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ApiRequestError } from "@/lib/api/errors";
import { clearAuthHint } from "@/lib/auth-hint";
import { isPublic, loginUrl, profilesUrl } from "@/lib/routes";
import { Toaster } from "@/components/ui/toaster";
import { TelegramBridge } from "@/components/telegram/telegram-bridge";
import { reauthUrl } from "@/lib/telegram";
import { hydrateUIPrefs } from "@/lib/ui-store";

let redirecting = false;

/**
 * Global recovery for session problems surfaced by any query:
 * `api()` already retried once after refreshing the token, so a 401 here means the session is gone.
 */
function handleSessionError(error: unknown) {
  if (typeof window === "undefined" || redirecting || !(error instanceof ApiRequestError)) return;
  const here = window.location.pathname + window.location.search;
  if (error.statusCode === 401 || error.code === "UNAUTHENTICATED") {
    clearAuthHint();
    if (isPublic(window.location.pathname)) return;
    redirecting = true;
    // Clear any stale httpOnly cookies so the proxy does not bounce us back into the app
    void fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" })
      .catch(() => undefined)
      .finally(() => {
        // Inside the Telegram Mini App the session can be restored silently from initData
        const tg = reauthUrl(here);
        if (tg) return window.location.assign(tg);
        const url = loginUrl(here);
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reset after session loss
        window.location.assign(`${url}${url.includes("?") ? "&" : "?"}expired=1`);
      });
  } else if (error.code === "PROFILE_REQUIRED") {
    if (window.location.pathname.startsWith("/profiles")) return;
    redirecting = true;
    window.location.assign(profilesUrl(here));
  }
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleSessionError }),
        mutationCache: new MutationCache({ onError: handleSessionError }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: (count, error) => {
              if (error instanceof ApiRequestError && error.statusCode === 429) return count < 3;
              if (error instanceof ApiRequestError && error.statusCode < 500) return false;
              return count < 2;
            },
            retryDelay: (count, error) =>
              error instanceof ApiRequestError && error.statusCode === 429 ? 2000 * 2 ** count : Math.min(1000 * 2 ** count, 8000),
          },
        },
      }),
  );
  useEffect(() => hydrateUIPrefs(), []);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delayDuration={300}>
          {children}
          <Toaster />
          <Suspense fallback={null}>
            <TelegramBridge />
          </Suspense>
        </Tooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
