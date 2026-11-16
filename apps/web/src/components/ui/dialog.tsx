"use client";

import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose = RDialog.Close;

interface DialogContentProps {
  title: string;
  description?: string;
  /** Hide the visual title (still announced to screen readers) */
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
  /** "center" dialog on all sizes, or "sheet" = bottom sheet on mobile / centered on desktop */
  variant?: "center" | "sheet";
}

export function DialogContent({ title, description, hideTitle, children, className, variant = "center" }: DialogContentProps) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[2px] data-[state=closed]:animate-[fade-in_.15s_reverse] data-[state=open]:animate-fade-in" />
      <RDialog.Content
        className={cn(
          "fixed z-[61] flex max-h-[92dvh] flex-col overflow-hidden bg-elevated text-white shadow-2xl shadow-black/70 outline-none",
          variant === "sheet"
            ? "inset-x-0 bottom-0 rounded-t-2xl sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(92vw,32rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
            : "top-1/2 left-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg",
          "data-[state=open]:animate-[dialog-in_.22s_cubic-bezier(.16,1,.3,1)]",
          className,
        )}
      >
        <div className={cn("flex items-start justify-between gap-4 px-6 pt-6", hideTitle && "sr-only")}>
          <div>
            <RDialog.Title className="text-xl font-bold">{title}</RDialog.Title>
            {description && <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>}
          </div>
        </div>
        {!description && <RDialog.Description className="sr-only">{title}</RDialog.Description>}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6">{children}</div>
        <RDialog.Close
          aria-label="Đóng"
          className="absolute top-4 right-4 rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </RDialog.Close>
      </RDialog.Content>
    </RDialog.Portal>
  );
}
