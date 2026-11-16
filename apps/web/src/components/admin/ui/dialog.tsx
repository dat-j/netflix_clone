"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/format";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-[1px] data-[state=open]:animate-[admin-fade_120ms_ease-out] motion-reduce:animate-none" />
        <D.Content
          className={cn(
            "admin-root fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-xl bg-white text-zinc-900 shadow-2xl outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-3.5">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-zinc-500">{description}</D.Description> : <D.Description className="sr-only">{typeof title === "string" ? title : "Hộp thoại"}</D.Description>}
            </div>
            <D.Close className="-mr-1 rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label="Đóng">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50/60 px-5 py-3 sm:rounded-b-xl">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
