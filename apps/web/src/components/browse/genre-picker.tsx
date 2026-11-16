"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useGenres } from "@/lib/queries";

export function GenrePicker({ label = "Thể loại" }: { label?: string }) {
  const { data: genres } = useGenres();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="inline-flex h-8 items-center gap-6 border border-white/90 bg-black/90 px-3 text-sm font-semibold text-white hover:bg-white/10 data-[state=open]:bg-white/10">
        {label}
        <ChevronDown className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-[70] grid max-h-[60vh] grid-cols-1 overflow-y-auto border border-white/15 bg-black/90 py-2 text-sm shadow-xl backdrop-blur sm:grid-cols-3"
        >
          {genres === undefined ? (
            <span className="px-4 py-2 text-white/60">Đang tải…</span>
          ) : genres.length === 0 ? (
            <span className="px-4 py-2 text-white/60">Chưa có thể loại</span>
          ) : (
            genres.map((g) => (
              <DropdownMenu.Item key={g.id} asChild>
                <Link href={`/browse/genre/${g.slug}`} className="block min-w-40 px-4 py-1.5 text-white/90 outline-none hover:underline data-[highlighted]:underline">
                  {g.name}
                </Link>
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
