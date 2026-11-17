import type { Metadata } from "next";
import Link from "next/link";
import { LogoLink } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { PlanActions } from "@/components/landing/plan-actions";
import { SiteFooter } from "@/components/layout/site-footer";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Gói dịch vụ",
  description: `So sánh các gói ${BRAND.name}: giá, chất lượng hình ảnh và số thiết bị xem cùng lúc.`,
};

export default function PlansPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-header items-center justify-between border-b border-white/10 px-gutter">
        <LogoLink />
        <Link href="/browse" className="text-sm font-semibold text-white/80 hover:text-white hover:underline">
          Về trang chủ
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-gutter py-10 md:py-14">
        <p className="text-xs font-semibold tracking-wider text-white/60 uppercase">Gói dịch vụ</p>
        <h1 className="mt-1 text-[clamp(1.75rem,3vw,2.5rem)] font-bold">Chọn gói phù hợp với bạn</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/65">
          Không bắt buộc mua gói để xem phim. Tài khoản miễn phí có thể xem nội dung ở chất lượng tối đa 720p và một thiết bị cùng lúc.
          Nâng cấp để mở khóa chất lượng hình ảnh cao hơn, xem trên nhiều thiết bị và thêm hồ sơ.
        </p>
        <section className="mt-8 mb-10 flex flex-col gap-5 rounded-xl border border-white/15 bg-white/[0.035] p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <p className="text-xs font-semibold tracking-wider text-white/50 uppercase">Bắt đầu miễn phí</p>
            <h2 className="mt-1 text-xl font-bold">Gói miễn phí · 0đ</h2>
            <p className="mt-2 text-sm text-white/60">720p · 1 thiết bị cùng lúc · tối đa 5 hồ sơ · không cần thẻ thanh toán</p>
          </div>
          <Button asChild variant="outline" size="lg">
            <Link href="/signup">Tạo tài khoản miễn phí</Link>
          </Button>
        </section>
        <h2 className="mb-4 text-xl font-bold">Nâng cấp trải nghiệm</h2>
        <PlanActions />
        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-white/45">
          Thanh toán được xử lý qua payOS. Gói được kích hoạt sau khi hệ thống xác minh giao dịch từ máy chủ thanh toán.
          Chất lượng thực tế còn phụ thuộc vào thiết bị, kết nối Internet và nguồn phát.
        </p>
      </main>
      <SiteFooter compact />
    </div>
  );
}
