"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleHelp, LogOut, Pencil, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/messages";
import { clearAuthHint } from "@/lib/auth-hint";
import { useMe, useProfiles, useSelectProfile } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import { BRAND } from "@/lib/brand";

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api("/auth/logout", { method: "POST", noRefresh: true });
    } catch {
      // cookies are cleared server-side when possible; the client state is reset regardless
    }
    clearAuthHint();
    qc.clear();
    // Hard navigation on purpose: drop every bit of in-memory per-user state
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  };
}

/** Avatar + caret; opens on hover (desktop) or click, like the reference product. */
export function ProfileMenu() {
  const { data: me } = useMe();
  const { data: profiles } = useProfiles();
  const select = useSelectProfile();
  const router = useRouter();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = me?.profile;
  const others = (profiles ?? []).filter((p) => p.id !== current?.id);

  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };

  const itemCls =
    "flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-[0.8125rem] text-white/90 outline-none hover:underline data-[highlighted]:underline";

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger
        onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}
        aria-label="Tài khoản và hồ sơ"
        data-testid="profile-menu-trigger"
        className="group flex items-center gap-2 rounded"
      >
        {current ? (
          <ProfileAvatar profile={current} className="size-8 rounded" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded bg-[#333]">
            <User className="size-5" />
          </span>
        )}
        <ChevronDown className={cn("size-4 transition-transform duration-300 max-md:hidden", open && "rotate-180")} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={18}
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          className="z-[70] w-56 border border-white/15 bg-black/90 py-2 text-white shadow-2xl backdrop-blur data-[state=open]:animate-fade-in"
        >
          <DropdownMenu.Arrow className="fill-white/80" width={14} height={7} />
          {others.map((p) => (
            <DropdownMenu.Item
              key={p.id}
              className={itemCls}
              onSelect={() =>
                select.mutate(p.id, {
                  onSuccess: () => {
                    router.push("/browse");
                    router.refresh();
                  },
                  onError: (e) => toast({ message: errorMessage(e), tone: "error" }),
                })
              }
            >
              <ProfileAvatar profile={p} className="size-8 rounded" />
              <span className="truncate">{p.name}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/profiles?manage=1">
              <Pencil className="size-5 text-white/70" />
              Quản lý hồ sơ
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/account">
              <User className="size-5 text-white/70" />
              Tài khoản
            </Link>
          </DropdownMenu.Item>
          {me?.user.role === "ADMIN" && (
            <DropdownMenu.Item asChild className={itemCls}>
              <Link href="/admin">
                <ShieldCheck className="size-5 text-white/70" />
                Quản trị
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/plans">
              <CircleHelp className="size-5 text-white/70" />
              Gói dịch vụ
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-2 h-px bg-white/25" />
          <DropdownMenu.Item className={cn(itemCls, "justify-center")} onSelect={() => void signOut()} data-testid="sign-out">
            <LogOut className="size-4 text-white/70" />
            Đăng xuất khỏi {BRAND.name}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
