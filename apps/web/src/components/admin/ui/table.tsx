"use client";

import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/format";
import { Skeleton } from "./primitives";

export function Table({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-zinc-50 text-left text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      <tr className="border-b border-zinc-200">{children}</tr>
    </thead>
  );
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("px-3 py-2 font-semibold whitespace-nowrap", className)} {...rest} />;
}

export function Tr({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr onClick={onClick} className={cn("border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80", onClick && "cursor-pointer", className)}>
      {children}
    </tr>
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2 align-middle text-zinc-700", className)} {...rest} />;
}

export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-zinc-100">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-3 py-3">
              <Skeleton className={cn("h-3.5", c === 0 ? "w-40" : "w-16")} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function FullRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <td colSpan={cols}>{children}</td>
      </tr>
    </tbody>
  );
}
