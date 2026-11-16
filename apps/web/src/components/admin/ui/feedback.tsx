"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../lib/format";
import { Dialog } from "./dialog";
import { Button } from "./primitives";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}
interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface FeedbackCtx {
  toast: (kind: ToastKind, title: string, description?: string) => void;
  toastError: (error: unknown, title?: string) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackCtx | null>(null);

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Lỗi không xác định";
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
    },
    [dismiss],
  );
  const toastError = useCallback((error: unknown, title = "Thao tác thất bại") => toast("error", title, errorMessage(error)), [toast]);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })), []);

  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  const value = useMemo(() => ({ toast, toastError, confirm }), [toast, toastError, confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={!!confirmState}
        onOpenChange={(o) => !o && close(false)}
        size="sm"
        title={confirmState?.title ?? ""}
        footer={
          <>
            <Button onClick={() => close(false)}>Huỷ</Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel ?? "Xác nhận"}
            </Button>
          </>
        }
      >
        {confirmState?.description ? <div className="text-sm text-zinc-600">{confirmState.description}</div> : null}
      </Dialog>
      <div aria-live="polite" className="pointer-events-none fixed right-0 bottom-0 z-[60] flex w-full flex-col items-end gap-2 p-3 sm:max-w-sm sm:p-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border bg-white px-3.5 py-3 text-sm shadow-lg ring-1 ring-black/5",
              t.kind === "error" ? "border-red-200" : t.kind === "success" ? "border-emerald-200" : "border-zinc-200",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : t.kind === "error" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-900">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-xs break-words text-zinc-600">{t.description}</p> : null}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700" aria-label="Đóng thông báo">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}
