import { Suspense } from "react";
import { MiniAppLink } from "@/components/telegram/mini-app-screens";
import { PageSpinner } from "@/components/ui/spinner";

/** Links the signed-in account to the Telegram user of the current Mini App launch, then continues to `to`. */
export default function TelegramLinkPage() {
  return (
    <Suspense fallback={<PageSpinner className="min-h-dvh" />}>
      <MiniAppLink />
    </Suspense>
  );
}
