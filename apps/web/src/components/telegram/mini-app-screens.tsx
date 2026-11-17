"use client";

import { sanitizeMiniAppPath, type MeResponse, type TelegramAuthResponse, type TelegramLinkResult, type UserDto } from "@app/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, ExternalLink, Link2, LogIn, MonitorX, Send, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/messages";
import { clearAuthHint, setAuthHint } from "@/lib/auth-hint";
import { profilesUrl } from "@/lib/routes";
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME, loadTelegram, miniAppEntry, openExternal } from "@/lib/telegram";

/** Product name used in all Telegram-facing copy. */
export const TG_BRAND = "BoxPhim";

function useTarget() {
  return sanitizeMiniAppPath(useSearchParams().get("to"));
}

/** Where to go after a Telegram sign-in/link: straight to the target when a profile is selected, else via the gate. */
const destination = (to: string, hasProfile: boolean) => (hasProfile ? to : profilesUrl(to));

/**
 * Hard navigation into the app: the new cookies are applied to the server render, and `/title/<slug>` opens as a
 * page (a soft navigation would be intercepted by the @modal route and render over this screen).
 * The Telegram SDK re-initialises from sessionStorage on the next page.
 */
function enterApp(path: string) {
  window.location.replace(new URL(path, window.location.origin).toString());
}

/** `/auth/*` calls skip the client's auto-refresh, so refresh once by hand when the access token expired. */
async function withRefresh<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!isApiError(e, "UNAUTHENTICATED")) throw e;
    const ok = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" }).then((r) => r.ok, () => false);
    if (!ok) throw e;
    return call();
  }
}

const currentUser = () =>
  withRefresh(() => api<MeResponse>("/auth/me", { noRefresh: true }))
    .then((me) => me.user)
    .catch(() => null);

// ───────── layout pieces ─────────
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-white" data-testid="tg-screen">
      <header className="flex h-14 items-center gap-2 px-5">
        <LogoMark className="text-[1.6rem] text-white" />
        <span className="text-xl font-black tracking-tight text-brand">{TG_BRAND}</span>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-10">{children}</main>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-5 text-center" role="status" aria-live="polite">
        <Spinner className="size-12 text-brand" label={label} />
        <p className="text-white/70">{label}</p>
      </div>
    </Shell>
  );
}

function Message({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Shell>
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/8 text-brand">{icon}</div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="space-y-2 text-[0.95rem] leading-relaxed text-white/70">{children}</div>
        {actions && <div className="flex flex-col gap-3 pt-3">{actions}</div>}
      </div>
    </Shell>
  );
}

function OutsideTelegram({ to }: { to: string }) {
  return (
    <Message icon={<Send className="size-8" />} title={`Mở ${TG_BRAND} từ Telegram`}>
      <p>Trang này dành cho ứng dụng {TG_BRAND} trong Telegram. Hãy mở bot {TG_BRAND} trên Telegram để đăng nhập tự động.</p>
      <p>Bạn vẫn có thể xem phim ngay trên website.</p>
      <div className="flex flex-col gap-3 pt-3">
        <Button asChild variant="brand" size="lg" className="w-full">
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" data-testid="tg-open-bot">
            <Send className="size-5" /> Mở trong Telegram (@{TELEGRAM_BOT_USERNAME})
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href={to} data-testid="tg-website">
            Tiếp tục trên website
          </Link>
        </Button>
      </div>
    </Message>
  );
}

/** Telegram Web embeds Mini Apps in a cross-site iframe; with SameSite=Lax cookies the session cannot stick there. */
function CookiesBlocked({ to }: { to: string }) {
  return (
    <Message
      icon={<MonitorX className="size-8" />}
      title="Không thể đăng nhập trong cửa sổ này"
      actions={
        <>
          <Button variant="brand" size="lg" className="w-full" onClick={() => openExternal(new URL(to, window.location.origin).toString())}>
            <ExternalLink className="size-5" /> Mở {TG_BRAND} trong trình duyệt
          </Button>
        </>
      }
    >
      <p>
        Phiên bản Telegram này (thường là Telegram Web trên trình duyệt) chặn cookie đăng nhập nên {TG_BRAND} không giữ được phiên.
      </p>
      <p>Hãy dùng ứng dụng Telegram trên điện thoại hoặc máy tính, hoặc mở {TG_BRAND} trong trình duyệt.</p>
    </Message>
  );
}

function ErrorScreen({ message, onRetry, to }: { message: string; onRetry?: () => void; to: string }) {
  return (
    <Message
      icon={<CircleAlert className="size-8" />}
      title="Có lỗi xảy ra"
      actions={
        <>
          {onRetry && (
            <Button variant="brand" size="lg" className="w-full" onClick={onRetry}>
              Thử lại
            </Button>
          )}
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href={miniAppEntry(to)}>Quay lại</Link>
          </Button>
        </>
      }
    >
      <p data-testid="tg-error">{message}</p>
    </Message>
  );
}

// ───────── /tg ─────────
type EntryState =
  | { kind: "loading" }
  | { kind: "outside" }
  | { kind: "blocked" }
  | { kind: "error"; message: string }
  | { kind: "not-linked"; firstName: string | null; username: string | null; me: UserDto | null };

export function MiniAppEntry() {
  const to = useTarget();
  const qc = useQueryClient();
  const [state, setState] = useState<EntryState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);

  useEffect(() => {
    if (ran.current === attempt) return;
    ran.current = attempt;
    void (async () => {
      const wa = await loadTelegram(true);
      if (!wa) return setState({ kind: "outside" });
      let res: TelegramAuthResponse;
      try {
        res = await api<TelegramAuthResponse>("/auth/telegram", { method: "POST", body: { initData: wa.initData }, noRefresh: true });
      } catch (e) {
        return setState({ kind: "error", message: errorMessage(e) });
      }
      if (res.linked) {
        setAuthHint();
        qc.clear();
        // The cookies must actually have been stored (they are not inside a cross-site iframe with SameSite=Lax)
        const user = await api<MeResponse>("/auth/me", { noRefresh: true }).then((m) => m.user, () => null);
        if (!user) {
          clearAuthHint();
          return setState({ kind: "blocked" });
        }
        enterApp(destination(to, !!res.profile));
        return;
      }
      setState({ kind: "not-linked", ...res.telegramUser, me: await currentUser() });
    })();
  }, [attempt, qc, to]);

  const useOtherAccount = useCallback(async () => {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    clearAuthHint();
    qc.clear();
    setState((s) => (s.kind === "not-linked" ? { ...s, me: null } : s));
  }, [qc]);

  switch (state.kind) {
    case "loading":
      return <Loading label={`Đang mở ${TG_BRAND}…`} />;
    case "outside":
      return <OutsideTelegram to={to} />;
    case "blocked":
      return <CookiesBlocked to={to} />;
    case "error":
      return <ErrorScreen message={state.message} to={to} onRetry={() => setAttempt((a) => a + 1)} />;
    case "not-linked":
      return <LinkIntro to={to} firstName={state.firstName} me={state.me} onUseOtherAccount={useOtherAccount} />;
  }
}

function LinkIntro({ to, firstName, me, onUseOtherAccount }: { to: string; firstName: string | null; me: UserDto | null; onUseOtherAccount: () => void }) {
  const linkPath = `/tg/link?to=${encodeURIComponent(to)}`;
  const authNext = encodeURIComponent(linkPath);
  return (
    <Shell>
      <div className="space-y-5" data-testid="tg-link-intro">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/8 text-brand">
          <Link2 className="size-8" />
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Liên kết tài khoản {TG_BRAND}</h1>
          <p className="text-[0.95rem] leading-relaxed text-white/70">
            {firstName ? `Chào ${firstName}! ` : "Xin chào! "}
            Liên kết Telegram với tài khoản {TG_BRAND} để xem phim ngay trong Telegram. Chỉ cần làm một lần — những lần sau bạn sẽ được đăng nhập tự động.
          </p>
        </div>

        {me ? (
          <div className="space-y-3">
            <p className="rounded bg-white/6 px-4 py-3 text-center text-sm text-white/80">
              Bạn đang đăng nhập với <strong className="text-white">{me.email}</strong>
            </p>
            <Button asChild variant="brand" size="lg" className="w-full">
              <Link href={linkPath} data-testid="tg-link-current">
                <Link2 className="size-5" /> Liên kết với tài khoản này
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="w-full" onClick={onUseOtherAccount}>
              Dùng tài khoản khác
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button asChild variant="brand" size="lg" className="w-full">
              <Link href={`/login?next=${authNext}`} data-testid="tg-login">
                <LogIn className="size-5" /> Đăng nhập
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link href={`/signup?next=${authNext}`} data-testid="tg-signup">
                <UserPlus className="size-5" /> Tạo tài khoản mới
              </Link>
            </Button>
          </div>
        )}

        <ul className="space-y-1.5 pt-2 text-[0.8125rem] leading-snug text-white/50">
          <li>• {TG_BRAND} chỉ nhận tên, tên người dùng và ID Telegram của bạn để đăng nhập — không đọc tin nhắn hay danh bạ.</li>
          <li>• Gói thuê bao và danh sách phim vẫn dùng chung với website.</li>
          <li>• Bạn có thể hủy liên kết bất cứ lúc nào trong trang Tài khoản.</li>
        </ul>
      </div>
    </Shell>
  );
}

// ───────── /tg/link ─────────
type LinkState = { kind: "loading" } | { kind: "outside" } | { kind: "error"; message: string; retry: boolean };

export function MiniAppLink() {
  const to = useTarget();
  const router = useRouter();
  const qc = useQueryClient();
  const [state, setState] = useState<LinkState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);

  useEffect(() => {
    if (ran.current === attempt) return;
    ran.current = attempt;
    void (async () => {
      const wa = await loadTelegram(true);
      if (!wa) return setState({ kind: "outside" });
      try {
        const res = await withRefresh(() =>
          api<TelegramLinkResult>("/auth/telegram/link", { method: "POST", body: { initData: wa.initData }, noRefresh: true }),
        );
        setAuthHint();
        void qc.invalidateQueries();
        enterApp(destination(to, !!res.profile));
      } catch (e) {
        // Not signed in (anymore) → back to the entry screen, which offers sign-in / sign-up
        if (isApiError(e, "UNAUTHENTICATED")) return router.replace(miniAppEntry(to));
        setState({
          kind: "error",
          message: errorMessage(e, {
            TELEGRAM_LINK_CONFLICT: e instanceof Error && e.message ? e.message : undefined,
          }),
          retry: !isApiError(e, "TELEGRAM_LINK_CONFLICT", "TELEGRAM_INIT_DATA_INVALID"),
        });
      }
    })();
  }, [attempt, qc, router, to]);

  if (state.kind === "loading") return <Loading label="Đang liên kết tài khoản…" />;
  if (state.kind === "outside") return <OutsideTelegram to={to} />;
  return <ErrorScreen message={state.message} to={to} onRetry={state.retry ? () => setAttempt((a) => a + 1) : undefined} />;
}
