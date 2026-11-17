"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { Suspense, useEffect, useState } from "react";
import { LogoLink } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { ProfileMenu } from "./profile-menu";
import { SearchBox } from "./search-box";

const NAV = [
  { href: "/browse", label: "Trang chủ" },
  { href: "/browse/series", label: "Phim bộ" },
  { href: "/browse/movies", label: "Phim lẻ" },
  { href: "/my-list", label: "Danh sách của tôi" },
];

function isActive(pathname: string, href: string) {
  return href === "/browse" ? pathname === "/browse" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const current = NAV.find((n) => isActive(pathname, n.href));

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 h-header transition-colors duration-500 tg:pt-[var(--tg-top)]",
        scrolled ? "bg-bg" : "bg-transparent",
      )}
    >
      {/* soft top scrim so white text stays readable over bright artwork */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-500",
          scrolled && "opacity-0",
        )}
      />
      <div className="relative flex h-full items-center px-gutter">
        {/* Telegram's own header already shows the bot name: drop the wordmark to keep the header compact */}
        <LogoLink href="/browse" className="mr-[clamp(0.75rem,2.5vw,2.75rem)] shrink-0 tg:hidden [&_span]:text-[1.6rem] md:[&_span]:text-[1.85rem]" />

        {/* desktop nav */}
        <nav aria-label="Điều hướng chính" className="max-lg:hidden">
          <ul className="flex items-center gap-[clamp(0.9rem,1.4vw,1.25rem)]">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(pathname, n.href) ? "page" : undefined}
                  className={cn(
                    "text-sm whitespace-nowrap transition-colors duration-300",
                    isActive(pathname, n.href) ? "font-bold text-white" : "text-[#e5e5e5] hover:text-[#b3b3b3]",
                  )}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* compact nav (tablet / mobile) */}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger className="flex items-center gap-1 text-sm font-semibold text-white lg:hidden" aria-label="Mở menu điều hướng">
            {current?.label === "Trang chủ" || !current ? "Duyệt" : current.label}
            <ChevronDown className="size-4" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="center"
              sideOffset={14}
              className="z-[70] w-64 border-t-2 border-white bg-black/95 py-2 shadow-2xl data-[state=open]:animate-fade-in"
            >
              {NAV.map((n) => (
                <DropdownMenu.Item key={n.href} asChild>
                  <Link
                    href={n.href}
                    className={cn(
                      "block py-3 text-center text-sm outline-none data-[highlighted]:bg-white/10",
                      isActive(pathname, n.href) ? "font-bold text-white" : "text-white/70",
                    )}
                  >
                    {n.label}
                  </Link>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <div className="ml-auto flex items-center gap-[clamp(0.5rem,1.3vw,1.25rem)]">
          <Suspense fallback={<div className="size-9" />}>
            <SearchBox />
          </Suspense>
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
