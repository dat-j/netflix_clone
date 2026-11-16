"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { FloatingInput } from "@/components/ui/input";

const schema = z.string().trim().pipe(z.email());

/** "Nhập email → Bắt đầu" capture that hands the email to /signup. */
export function EmailCapture({ className }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError("Vui lòng nhập email.");
    if (!schema.safeParse(email).success) return setError("Vui lòng nhập địa chỉ email hợp lệ.");
    router.push(`/signup?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <form onSubmit={onSubmit} noValidate className={className}>
      <p className="mb-4 text-center text-[clamp(1rem,1.3vw,1.25rem)] text-white/95">
        Bạn đã sẵn sàng xem chưa? Nhập email để tạo hoặc kích hoạt lại tài khoản thành viên.
      </p>
      <div className="mx-auto flex max-w-[37rem] flex-col items-center gap-3 sm:flex-row sm:items-start">
        <FloatingInput
          id={id}
          label="Địa chỉ email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          error={error}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className="flex-1"
        />
        <button
          type="submit"
          className="inline-flex h-14 shrink-0 items-center gap-2 rounded bg-brand px-6 text-xl font-bold whitespace-nowrap text-brand-ink transition-colors hover:bg-brand-hover sm:text-2xl"
        >
          Bắt đầu
          <ChevronRight className="size-6" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}
