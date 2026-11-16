"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Cpu,
  CreditCard,
  ExternalLink,
  Film,
  HardDrive,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { api, ApiRequestError } from "@/lib/api/client";
import { cn } from "./lib/format";
import { useMe, useStats } from "./lib/queries";
import { FeedbackProvider } from "./ui/feedback";
import { Button, ErrorState, Spinner } from "./ui/primitives";

/** Router hiện tại — QueryCache sống ngoài React nên giữ tham chiếu để điều hướng khi gặp lỗi xác thực. */
let navigate: ((href: string) => void) | null = null;

function redirectForAuthError(error: unknown) {
  if (!(error instanceof ApiRequestError) || typeof window === "undefined" || !navigate) return;
  if (error.statusCode === 401) {
    navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  } else if (error.code === "PROFILE_REQUIRED") {
    navigate("/profiles");
  }
}

function makeClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: redirectForAuthError }),
    mutationCache: new MutationCache({ onError: redirectForAuthError }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => {
          if (error instanceof ApiRequestError && error.statusCode >= 400 && error.statusCode < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

const NAV = [
  { href: "/admin", label: "Tổng quan", icon: LayoutDashboard, exact: true },
  { href: "/admin/titles", label: "Phim", icon: Film },
  { href: "/admin/source-files", label: "Kho file nguồn", icon: HardDrive },
  { href: "/admin/jobs", label: "Tác vụ transcode", icon: Cpu, badge: "jobs" as const },
  { href: "/admin/home", label: "Trang chủ", icon: LayoutTemplate },
  { href: "/admin/users", label: "Người dùng", icon: Users },
  { href: "/admin/plans", label: "Gói cước", icon: CreditCard },
];

export function AdminApp({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  const router = useRouter();
  useEffect(() => {
    navigate = (href) => router.replace(href);
    return () => {
      navigate = null;
    };
  }, [router]);
  return (
    <QueryClientProvider client={client}>
      <FeedbackProvider>
        <style>{`@keyframes admin-fade{from{opacity:0}to{opacity:1}}`}</style>
        <AdminGate>{children}</AdminGate>
      </FeedbackProvider>
    </QueryClientProvider>
  );
}

export function AdminBootScreen() {
  return (
    <div className="admin-root flex min-h-dvh flex-1 items-center justify-center bg-zinc-100 text-zinc-600">
      <Spinner className="size-6" />
    </div>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) return <AdminBootScreen />;
  if (me.isError) {
    const e = me.error;
    if (e instanceof ApiRequestError && e.statusCode === 401) return <AdminBootScreen />; // đang chuyển tới /login
    return (
      <div className="admin-root flex min-h-dvh flex-1 items-center justify-center bg-zinc-100 p-4">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-sm">
          <ErrorState error={e} onRetry={() => me.refetch()} />
        </div>
      </div>
    );
  }
  if (me.data.user.role !== "ADMIN") return <Forbidden email={me.data.user.email} />;
  return <AdminLayout email={me.data.user.email}>{children}</AdminLayout>;
}

function Forbidden({ email }: { email: string }) {
  return (
    <div className="admin-root flex min-h-dvh flex-1 items-center justify-center bg-zinc-100 p-4 text-zinc-900">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-50">
          <ShieldAlert className="size-6 text-red-600" />
        </div>
        <p className="text-xs font-semibold tracking-widest text-red-600 uppercase">403 · Không có quyền</p>
        <h1 className="mt-2 text-lg font-semibold">Khu vực dành cho quản trị viên</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Tài khoản <span className="font-medium text-zinc-900">{email}</span> không có quyền truy cập trang quản trị.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/browse" className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
            Về trang xem phim
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminLayout({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)));

  return (
    <div className="admin-root flex min-h-dvh w-full flex-1 bg-zinc-100 text-zinc-900 [color-scheme:light]">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col bg-zinc-950 text-zinc-300 lg:flex">
        <Sidebar email={email} pathname={pathname} />
      </aside>

      {/* Drawer mobile */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-zinc-950 text-zinc-300 shadow-2xl">
            <button className="absolute top-3 right-3 rounded p-1 text-zinc-400 hover:text-white" onClick={() => setOpen(false)} aria-label="Đóng menu">
              <X className="size-5" />
            </button>
            <Sidebar email={email} pathname={pathname} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-zinc-200 bg-white/90 px-3 backdrop-blur lg:hidden">
          <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="Mở menu">
            <Menu className="size-5" />
          </Button>
          <Brand dark={false} />
          <span className="ml-auto truncate text-[13px] font-medium text-zinc-600">{current?.label}</span>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <Link href="/admin" className="flex items-center gap-2">
      <span className={cn("text-lg font-black tracking-tight", dark ? "text-white" : "text-zinc-900")}>
        Lumio
      </span>
      <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-brand-ink uppercase">Admin</span>
    </Link>
  );
}

function Sidebar({ email, pathname }: { email: string; pathname: string }) {
  const router = useRouter();
  const stats = useStats();
  const activeJobs = (stats.data?.jobsRunning ?? 0) + (stats.data?.jobsQueued ?? 0);
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", noRefresh: true });
    } finally {
      router.replace("/login");
    }
  };
  return (
    <>
      <div className="flex h-14 items-center border-b border-white/10 px-4">
        <Brand />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Quản trị">
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
              )}
            >
              <Icon className={cn("size-4", active ? "text-brand" : "")} aria-hidden />
              <span className="flex-1">{n.label}</span>
              {n.badge === "jobs" && activeJobs > 0 ? (
                <span className="rounded-full bg-indigo-500/20 px-1.5 text-[11px] font-semibold text-indigo-300 tabular-nums">{activeJobs}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-white/10 p-2">
        <Link href="/browse" className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
          <ExternalLink className="size-4" aria-hidden /> Về trang xem phim
        </Link>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-ink uppercase">{email[0]}</div>
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={email}>
            {email}
          </span>
          <button onClick={logout} className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white" aria-label="Đăng xuất" title="Đăng xuất">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}
