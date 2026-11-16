"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

/**
 * Netflix-style expanding search: the icon grows into a field; typing debounces into
 * /search?q=… (replace, so Back returns to where search started); clearing returns there.
 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [open, setOpen] = useState(urlQ.length > 0);
  const [value, setValue] = useState(urlQ);
  const inputRef = useRef<HTMLInputElement>(null);
  const origin = useRef<string>("/browse");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushed = useRef(urlQ);

  // Sync from the URL (back/forward, direct load) — derived during render, not in an effect
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    if (urlQ.trim() !== value.trim()) {
      setValue(urlQ);
      if (urlQ) setOpen(true);
    }
  }
  useEffect(() => {
    lastPushed.current = urlQ;
  }, [urlQ]);

  useEffect(() => {
    if (pathname !== "/search") origin.current = pathname + (params.size ? `?${params.toString()}` : "");
  }, [pathname, params]);

  const navigate = (q: string) => {
    const term = q.trim();
    if (term === lastPushed.current.trim()) return;
    lastPushed.current = term;
    if (!term) {
      if (pathname === "/search") router.replace(origin.current, { scroll: false });
      return;
    }
    const url = `/search?q=${encodeURIComponent(term)}`;
    if (pathname === "/search") router.replace(url, { scroll: false });
    else router.push(url);
  };

  const onChange = (q: string) => {
    setValue(q);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate(q), DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="relative flex size-9 items-center justify-end sm:w-auto" role="search">
      <div
        className={cn(
          "z-10 flex h-9 items-center overflow-hidden border transition-[width,background-color,border-color] duration-300 ease-out-expo",
          // phones: the open field overlays the logo/nav instead of pushing the avatar off-screen
          "max-sm:absolute max-sm:top-0 max-sm:right-0",
          open
            ? "w-[calc(100vw-2*var(--gutter)-3rem)] border-white/90 bg-black sm:bg-black/80 sm:w-[min(17rem,40vw)]"
            : "w-9 border-transparent bg-transparent",
        )}
      >
        <button
          type="button"
          aria-label="Tìm kiếm"
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex size-9 shrink-0 items-center justify-center text-white"
        >
          <Search className="size-[1.35rem]" strokeWidth={2.2} />
        </button>
        <input
          ref={inputRef}
          type="search"
          value={value}
          tabIndex={open ? 0 : -1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              navigate(value);
            }
            if (e.key === "Escape") {
              onChange("");
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          onBlur={() => {
            if (!value) setOpen(false);
          }}
          placeholder="Phim, diễn viên, thể loại…"
          aria-label="Tìm phim, diễn viên, thể loại"
          className="min-w-0 flex-1 bg-transparent pr-1 text-sm text-white outline-none placeholder:text-white/50 [&::-webkit-search-cancel-button]:hidden"
          data-testid="search-input"
        />
        {open && value && (
          <button
            type="button"
            aria-label="Xóa tìm kiếm"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="flex size-8 shrink-0 items-center justify-center text-white/80 hover:text-white"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
