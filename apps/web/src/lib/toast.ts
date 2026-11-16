"use client";

import { create } from "zustand";

export type ToastTone = "default" | "success" | "error";
export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id" | "tone"> & { tone?: ToastTone; durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ durationMs = 3500, tone = "default", ...t }) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, tone, ...t }] }));
    setTimeout(() => get().dismiss(id), durationMs);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Parameters<ToastState["push"]>[0]) => useToastStore.getState().push(t);
