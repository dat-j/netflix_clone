"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import type { PaymentDto } from "@app/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { formatDate, formatPrice } from "@/lib/utils";

export function PaymentResult({ paymentId }: { paymentId?: string }) {
  const payment = useQuery({
    queryKey: ["billing", "payment", paymentId],
    queryFn: () => api<PaymentDto>(`/billing/payments/${paymentId}`),
    enabled: !!paymentId,
    refetchInterval: (query) => query.state.data?.status === "PENDING" ? 2500 : false,
    retry: 2,
  });

  const status = payment.data?.status;
  const icon = status === "SUCCEEDED" ? <CheckCircle2 className="size-12 text-success" /> :
    status === "FAILED" || status === "REFUNDED" ? <XCircle className="size-12 text-danger" /> :
    <Clock3 className="size-12 text-warning" />;

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      {icon}
      <h1 className="mt-5 text-3xl font-bold">
        {!paymentId ? "Không tìm thấy giao dịch" :
          status === "SUCCEEDED" ? "Thanh toán thành công" :
          status === "FAILED" ? "Thanh toán thất bại" :
          status === "REFUNDED" ? "Giao dịch đã hoàn tiền" :
          payment.isError ? "Chưa thể tra cứu giao dịch" : "Đang xác nhận thanh toán"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-white/60">
        {status === "SUCCEEDED"
          ? "Gói thành viên đã được kích hoạt. Bạn có thể tiếp tục xem phim ngay."
          : status === "FAILED"
            ? "Giao dịch chưa thành công. Bạn có thể thử thanh toán lại từ trang gói thành viên."
            : "Lumio đang chờ xác nhận an toàn từ payOS. Đừng thanh toán lại khi giao dịch vẫn đang được xử lý."}
      </p>
      {payment.data && (
        <div className="mt-6 w-full rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left text-sm">
          <div className="flex justify-between gap-4"><span className="text-white/50">Gói</span><strong>{payment.data.plan.name}</strong></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-white/50">Số tiền</span><strong>{formatPrice(payment.data.amount, payment.data.currency)}</strong></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-white/50">Mã giao dịch</span><span className="font-mono text-xs">{payment.data.id.slice(0, 12)}</span></div>
          <div className="mt-2 flex justify-between gap-4"><span className="text-white/50">Tạo lúc</span><span>{formatDate(payment.data.createdAt)}</span></div>
        </div>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="brand"><Link href="/browse">Xem phim</Link></Button>
        <Button asChild variant="outline"><Link href="/account">Tài khoản</Link></Button>
        <Button asChild variant="ghost"><Link href="/plans">Các gói dịch vụ</Link></Button>
      </div>
    </main>
  );
}
