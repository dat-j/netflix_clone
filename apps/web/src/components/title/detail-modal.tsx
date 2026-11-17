"use client";

import { Dialog } from "radix-ui";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DetailView } from "./detail-view";

/**
 * Detail modal rendered by the intercepted /title/[slug] route. Radix Dialog gives us focus trap,
 * Esc, scroll lock and aria; closing plays the exit animation then navigates back.
 */
export function DetailModal({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const close = useCallback(() => {
    // Radix can report the same close from Escape, outside-click and the close button.
    // Guard it so multiple history navigations cannot race each other.
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      router.back();
      closeTimer.current = null;
    }, 180);
  }, [router]);

  // Next may preserve an intercepted parallel-route segment in its cache. Reset
  // the exit state whenever a new title is opened, including reopening the same URL.
  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
    scrollRef.current?.scrollTo({ top: 0 });
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [slug, pathname]);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay
          ref={scrollRef}
          className={cn(
            "fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black/70 transition-opacity duration-200",
            closing ? "opacity-0" : "animate-fade-in",
          )}
          data-testid="detail-modal"
        >
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // focus the dialog itself rather than the first button (no visible ring on open)
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus();
            }}
            className={cn(
              "relative mx-auto min-h-dvh w-full overflow-hidden bg-elevated shadow-[0_3px_10px_rgba(0,0,0,0.75)] outline-none",
              "md:mt-8 md:mb-8 md:min-h-0 md:w-[min(94vw,850px)] md:rounded-lg",
              "transition-[opacity,translate,scale] duration-200 ease-out-expo",
              closing
                ? "translate-y-6 scale-[0.98] opacity-0"
                : "animate-[dialog-in_.32s_cubic-bezier(.16,1,.3,1)] max-md:animate-[sheet-in_.32s_cubic-bezier(.16,1,.3,1)]",
            )}
          >
            <DetailView idOrSlug={slug} mode="modal" onClose={close} TitleTag={Dialog.Title} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
