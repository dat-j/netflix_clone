"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useToastStore } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-3 rounded-md border border-white/10 bg-[#2a2a2a]/95 py-3 pr-2 pl-4 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur",
            )}
          >
            {t.tone === "error" ? (
              <CircleAlert className="size-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
            )}
            <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded px-2 py-1 font-semibold text-white hover:bg-white/10"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Đóng thông báo"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
