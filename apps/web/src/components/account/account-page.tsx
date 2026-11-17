"use client";

import type { DeviceSession, SubscriptionDto } from "@app/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ChevronRight, CircleAlert, Laptop, LogOut, Mail, MonitorSmartphone, Smartphone, Tablet, Tv } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorPanel } from "@/components/browse/state-panels";
import { useSignOut } from "@/components/layout/profile-menu";
import { useIsClient } from "@/lib/hooks/use-media";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/messages";
import { BRAND } from "@/lib/brand";
import { qk, useDeviceSessions, useMe, useProfiles } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn, formatDate, formatPrice, formatRelative, qualityLabel } from "@/lib/utils";
import { TelegramSection } from "./telegram-section";

const STATUS_LABEL: Record<SubscriptionDto["status"], string> = {
  ACTIVE: "Đang hoạt động",
  PAST_DUE: "Quá hạn thanh toán",
  CANCELED: "Đã hủy",
  EXPIRED: "Đã hết hạn",
};

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-3 border-t border-white/10 py-6 md:grid-cols-[14rem_1fr] md:gap-8", className)} aria-label={title}>
      <h2 className="text-sm font-semibold tracking-wide text-white/50 uppercase">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function AccountPage() {
  const query = useMe();
  const signOut = useSignOut();
  // The header shares the `me` query and may resolve it before this segment hydrates:
  // render the loading state until hydration is done so server and client markup match.
  const hydrated = useIsClient();
  const { data: me, error, refetch } = query;
  const isPending = query.isPending || !hydrated;

  return (
    <div className="mx-auto w-full max-w-[60rem] px-gutter pt-[calc(var(--header-h)+2rem)] pb-16 md:pt-[calc(var(--header-h)+3rem)]" data-testid="account-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">Tài khoản</h1>
          {me && hydrated && <p className="mt-1 text-sm text-white/60">Thành viên từ {formatDate(me.user.createdAt, { month: "long", year: "numeric" })}</p>}
        </div>
      </div>

      {isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error || !me ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <MembershipCard subscription={me.subscription} />

          <Section title="Thông tin đăng nhập">
            <div className="flex flex-wrap items-center gap-3">
              <Mail className="size-5 text-white/50" aria-hidden />
              <span className="font-semibold break-all">{me.user.email}</span>
              {me.user.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                  <BadgeCheck className="size-3.5" /> Đã xác minh
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  <CircleAlert className="size-3.5" /> Chưa xác minh
                </span>
              )}
            </div>
            {!me.user.emailVerified && (
              <p className="mt-2 text-sm text-white/60">Kiểm tra hộp thư của bạn và nhấn vào liên kết xác minh chúng tôi đã gửi khi bạn đăng ký.</p>
            )}
            <Link href="/forgot-password" className="mt-3 inline-flex items-center gap-1 text-sm text-[#54b9c5] hover:underline">
              Đổi mật khẩu <ChevronRight className="size-4" />
            </Link>
          </Section>

          <ProfilesSection />
          <DevicesSection />
          <TelegramSection />

          <Section title="Đăng xuất">
            <Button variant="outline" onClick={() => void signOut()}>
              <LogOut className="size-4" /> Đăng xuất khỏi {BRAND.name}
            </Button>
          </Section>
        </>
      )}
    </div>
  );
}

function MembershipCard({ subscription }: { subscription: SubscriptionDto | null }) {
  const active = subscription?.status === "ACTIVE";
  const plan = subscription?.plan;

  if (!active) {
    return (
      <div className="mb-8 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1c]" data-testid="membership-inactive">
        <div className="bg-gradient-to-r from-brand/40 via-brand/10 to-transparent px-6 py-3 text-sm font-semibold">
          {subscription ? `Gói ${subscription.plan.name} · ${STATUS_LABEL[subscription.status]}` : "Chưa có gói thuê bao"}
        </div>
        <div className="space-y-4 p-6">
          <h2 className="text-2xl font-bold">{subscription ? "Gia hạn để tiếp tục xem" : "Liên hệ để kích hoạt gói"}</h2>
          <p className="max-w-xl text-white/70">
            {subscription
              ? `Gói của bạn đã kết thúc vào ${formatDate(subscription.currentPeriodEnd)}. `
              : "Tài khoản của bạn chưa có gói xem phim. "}
            Thanh toán trực tuyến sẽ sớm ra mắt — hiện tại, vui lòng liên hệ bộ phận hỗ trợ để được kích hoạt gói ngay.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="brand" size="lg">
              <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent("Kích hoạt gói thuê bao")}`}>Liên hệ kích hoạt</a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/plans">Xem các gói</Link>
            </Button>
          </div>
          <p className="text-sm text-white/50">
            Hotline: {BRAND.supportPhone} · Email: {BRAND.supportEmail}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1c]" data-testid="membership-active">
      <div className="flex items-center justify-between bg-gradient-to-r from-brand via-brand/60 to-[#6b1f8f]/70 px-6 py-3">
        <span className="text-sm font-semibold">Gói thành viên</span>
        <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs font-semibold">{STATUS_LABEL[subscription.status]}</span>
      </div>
      <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="text-2xl font-bold">Gói {plan!.name}</h2>
          <p className="mt-1 text-white/70">
            {formatPrice(plan!.priceAmount, plan!.currency)}/{plan!.intervalMonths > 1 ? `${plan!.intervalMonths} tháng` : "tháng"}
          </p>
          <ul className="mt-4 grid gap-1.5 text-sm text-white/85 sm:grid-cols-2">
            <li>Chất lượng tối đa: {qualityLabel(plan!.maxHeight)} ({plan!.maxHeight}p)</li>
            <li>Xem cùng lúc: {plan!.maxConcurrentStreams} thiết bị</li>
            <li>Tối đa {plan!.maxProfiles} hồ sơ</li>
            <li>Thanh toán: {subscription.provider === "manual" ? "Kích hoạt thủ công" : subscription.provider}</li>
          </ul>
        </div>
        <div className="rounded-md bg-white/5 px-4 py-3 text-sm">
          <p className="text-white/60">{subscription.cancelAtPeriodEnd ? "Kết thúc vào" : "Có hiệu lực đến"}</p>
          <p className="text-lg font-bold">{formatDate(subscription.currentPeriodEnd)}</p>
        </div>
      </div>
    </div>
  );
}

function ProfilesSection() {
  const { data: profiles, isPending } = useProfiles();
  return (
    <Section title="Hồ sơ">
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <ul className="flex flex-wrap gap-3">
            {profiles?.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-md bg-white/5 py-1.5 pr-3 pl-1.5">
                <ProfileAvatar profile={p} className="size-9 rounded" />
                <span className="text-sm font-medium">{p.name}</span>
                {p.isKids && <span className="rounded bg-white/10 px-1.5 text-[0.65rem] font-bold">TRẺ EM</span>}
              </li>
            ))}
          </ul>
          <Link href="/profiles?manage=1" className="inline-flex items-center gap-1 text-sm text-[#54b9c5] hover:underline">
            Quản lý hồ sơ <ChevronRight className="size-4" />
          </Link>
        </div>
      )}
    </Section>
  );
}

function describeDevice(s: DeviceSession) {
  const ua = s.userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const kind = /iPad|Tablet/.test(ua) ? "tablet" : /Mobile|iPhone|Android/.test(ua) ? "phone" : /TV|SmartTV|Tizen|webOS/.test(ua) ? "tv" : ua ? "desktop" : "unknown";
  const name = s.deviceName ?? ([browser, os].filter(Boolean).join(" trên ") || "Thiết bị không xác định");
  return { name, kind };
}

function DeviceIcon({ kind }: { kind: string }) {
  const Icon = kind === "phone" ? Smartphone : kind === "tablet" ? Tablet : kind === "tv" ? Tv : kind === "desktop" ? Laptop : MonitorSmartphone;
  return <Icon className="size-6 text-white/60" aria-hidden />;
}

function DevicesSection() {
  const { data, isPending, error, refetch } = useDeviceSessions();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<DeviceSession | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ message: "Đã đăng xuất thiết bị" });
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    onError: (e) => toast({ message: errorMessage(e), tone: "error" }),
  });

  return (
    <Section title="Thiết bị đã đăng nhập">
      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 text-sm text-white/60">
          {errorMessage(error)}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            Thử lại
          </Button>
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-white/60">Không có phiên đăng nhập nào.</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-md border border-white/10" data-testid="device-sessions">
          {[...data]
            .sort((a, b) => Number(b.current) - Number(a.current) || +new Date(b.lastUsedAt) - +new Date(a.lastUsedAt))
            .map((s) => {
              const d = describeDevice(s);
              return (
                <li key={s.id} className="flex items-center gap-4 px-4 py-3">
                  <DeviceIcon kind={d.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{d.name}</span>
                      {s.current && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[0.7rem] font-semibold text-success">Thiết bị này</span>}
                    </p>
                    <p className="text-xs text-white/50">
                      {s.ip ? `${s.ip.replace(/^::ffff:/, "")} · ` : ""}Hoạt động {formatRelative(s.lastUsedAt).toLowerCase()} · Đăng nhập {formatDate(s.createdAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button size="sm" variant="ghost" className="text-white/80" onClick={() => setConfirm(s)}>
                      Đăng xuất
                    </Button>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title="Đăng xuất thiết bị này?" description={confirm ? describeDevice(confirm).name : undefined}>
          <p className="text-sm text-white/70">Thiết bị sẽ phải đăng nhập lại để tiếp tục xem.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Hủy
            </Button>
            <Button variant="brand" loading={revoke.isPending} onClick={() => confirm && revoke.mutate(confirm.id)}>
              Đăng xuất thiết bị
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
