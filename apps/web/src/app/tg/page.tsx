import { Suspense } from "react";
import { MiniAppEntry } from "@/components/telegram/mini-app-screens";
import { PageSpinner } from "@/components/ui/spinner";

/** Telegram Mini App entry: `/tg?to=<in-app path>` (see sanitizeMiniAppPath for the allow-list). */
export default function TelegramEntryPage() {
  return (
    <Suspense fallback={<PageSpinner className="min-h-dvh" />}>
      <MiniAppEntry />
    </Suspense>
  );
}
