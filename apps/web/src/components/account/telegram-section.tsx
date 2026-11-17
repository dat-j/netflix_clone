"use client";

import type { TelegramLinkStatus } from "@app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/messages";
import { TELEGRAM_BOT_URL, useTelegram } from "@/lib/telegram";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/utils";
import { Section } from "./account-page";

const KEY = ["telegram-link"] as const;

export function TelegramSection() {
  const qc = useQueryClient();
  const inTelegram = !!useTelegram();
  const [confirm, setConfirm] = useState(false);
  const { data, isPending, error } = useQuery({ queryKey: KEY, queryFn: () => api<TelegramLinkStatus>("/auth/telegram/link") });
  const unlink = useMutation({
    mutationFn: () => api("/auth/telegram/link", { method: "DELETE" }),
    onSuccess: () => {
      toast({ message: "Đã hủy liên kết Telegram" });
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast({ message: errorMessage(e), tone: "error" }),
  });

  if (error || (data && !data.available && !data.link)) return null;
  const link = data?.link;
  const who = link ? (link.username ? `@${link.username}` : [link.firstName, link.lastName].filter(Boolean).join(" ") || `ID ${link.telegramUserId}`) : null;

  return (
    <Section title="Telegram">
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : link ? (
        <div className="flex flex-wrap items-center gap-4" data-testid="telegram-linked">
          <Send className="size-5 text-[#2aabee]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Đã liên kết với <strong>{who}</strong>
            </p>
            <p className="text-xs text-white/50">
              Liên kết {formatDate(link.linkedAt)} · Mở BoxPhim từ Telegram để đăng nhập tự động
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
            Hủy liên kết
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-white/70" data-testid="telegram-unlinked">
          <p>Liên kết Telegram để tìm phim với bot BoxPhim và xem ngay trong Telegram mà không cần đăng nhập lại.</p>
          {inTelegram ? (
            <Button asChild size="sm" variant="brand">
              <Link href="/tg/link?to=%2Faccount">Liên kết Telegram này</Link>
            </Button>
          ) : (
            <>
              <p className="text-white/50">Mở bot BoxPhim trên Telegram và nhấn nút mở ứng dụng để liên kết.</p>
              <Button asChild size="sm" variant="outline">
                <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" data-testid="telegram-bot-link">
                  <Send className="size-4" /> Mở bot BoxPhim trên Telegram
                </a>
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Hủy liên kết Telegram?" description={who ?? undefined}>
          <p className="text-sm text-white/70">Lần sau mở BoxPhim từ Telegram, bạn sẽ cần đăng nhập và liên kết lại.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Giữ liên kết
            </Button>
            <Button variant="brand" loading={unlink.isPending} onClick={() => unlink.mutate()}>
              Hủy liên kết
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
