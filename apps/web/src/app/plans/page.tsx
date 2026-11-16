import type { Metadata } from "next";
import Link from "next/link";
import { LogoLink } from "@/components/brand/logo";
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
        <ul className="mt-4 mb-8 space-y-1.5 text-white/75">
          <li>✓ Xem mọi thứ bạn muốn, không quảng cáo.</li>
          <li>✓ Đề xuất dành riêng cho bạn.</li>
          <li>✓ Đổi hoặc hủy gói bất kỳ lúc nào.</li>
        </ul>
        <PlanActions />
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-white/50">
          Thanh toán trực tuyến sẽ sớm ra mắt. Hiện tại gói được kích hoạt thủ công: liên hệ {BRAND.supportEmail} hoặc {BRAND.supportPhone} sau khi đăng ký. Chất
          lượng HD (720p), Full HD (1080p) tùy thuộc vào dịch vụ internet và khả năng của thiết bị. Không phải mọi nội dung đều có ở mọi độ phân giải.
        </p>
      </main>
      <SiteFooter compact />
    </div>
  );
}
