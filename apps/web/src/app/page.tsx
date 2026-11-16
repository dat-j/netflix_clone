import { Download, MonitorPlay, Smile, Sparkles, Tv, Users } from "lucide-react";
import Link from "next/link";
import { LogoLink } from "@/components/brand/logo";
import { EmailCapture } from "@/components/landing/email-capture";
import { Faq } from "@/components/landing/faq";
import { PlanCards, PlanPriceTeaser } from "@/components/landing/plan-cards";
import { PosterWall } from "@/components/landing/poster-wall";
import { SiteFooter } from "@/components/layout/site-footer";
import { BRAND } from "@/lib/brand";

const REASONS = [
  { icon: Tv, title: "Thưởng thức trên màn hình lớn", body: "Xem trên trình duyệt của Smart TV, máy tính, hoặc truyền từ điện thoại lên TV.", tint: "from-[#1d2b64]" },
  { icon: Download, title: "Xem tiếp từ chỗ bạn dừng", body: "Tiến độ được lưu tự động trên mọi thiết bị — mở là xem tiếp ngay.", tint: "from-[#5b1d47]" },
  { icon: MonitorPlay, title: "Xem ở mọi nơi", body: "Phát trực tuyến không giới hạn phim và series trên điện thoại, máy tính bảng và máy tính.", tint: "from-[#13406b]" },
  { icon: Smile, title: "Tạo hồ sơ cho trẻ em", body: "Các bé phiêu lưu cùng nhân vật yêu thích trong không gian riêng, an toàn.", tint: "from-[#6b2b11]" },
];

export default function LandingPage() {
  return (
    <div className="bg-black">
      {/* hero */}
      <section className="relative isolate flex min-h-[min(100svh,56rem)] flex-col overflow-hidden" aria-labelledby="hero-title">
        <PosterWall />
        <header className="relative z-10 mx-auto flex w-full max-w-[120rem] items-center justify-between px-gutter py-5 md:py-6 lg:px-[max(var(--gutter),8rem)]">
          <LogoLink />
          <Link
            href="/login"
            className="rounded bg-brand px-4 py-1.5 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-hover"
            data-testid="landing-login"
          >
            Đăng nhập
          </Link>
        </header>
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 pt-8 pb-24 text-center">
          <h1 id="hero-title" className="text-[clamp(2rem,4.6vw,4rem)] leading-[1.1] font-black tracking-tight text-balance">
            {BRAND.tagline}
          </h1>
          <p className="mt-4 text-[clamp(1.05rem,1.6vw,1.5rem)] font-medium text-white/95">
            <PlanPriceTeaser />
          </p>
          <EmailCapture className="mt-8 w-full" />
        </div>
        {/* glowing arc divider */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-24 translate-y-1/2">
          <div className="absolute inset-x-[-10%] top-0 h-full rounded-[50%_50%_0_0/100%_100%_0_0] border-t-4 border-brand bg-black shadow-[0_-12px_40px_-6px_var(--brand)]" />
        </div>
      </section>

      <div className="relative z-20 mx-auto max-w-[96rem] px-gutter pt-16 lg:px-[max(var(--gutter),8rem)]">
        {/* reasons */}
        <section aria-labelledby="reasons" className="py-10">
          <h2 id="reasons" className="mb-5 text-[clamp(1.25rem,1.8vw,1.6rem)] font-bold">
            Thêm lý do để tham gia
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {REASONS.map(({ icon: Icon, title, body, tint }) => (
              <li key={title} className={`relative flex min-h-60 flex-col rounded-2xl bg-gradient-to-br ${tint} to-[#151a2e] to-80% p-6 pb-20`}>
                <h3 className="text-[1.4rem] leading-tight font-bold">{title}</h3>
                <p className="mt-3 text-white/70">{body}</p>
                <Icon className="absolute right-5 bottom-5 size-14 text-brand drop-shadow-[0_0_18px_rgb(255_90_60/.45)]" strokeWidth={1.5} aria-hidden />
              </li>
            ))}
          </ul>
        </section>

        {/* plans */}
        <section aria-labelledby="plans" className="py-10" id="plans">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <h2 id="plans" className="text-[clamp(1.25rem,1.8vw,1.6rem)] font-bold">
              Chọn gói phù hợp với bạn
            </h2>
            <p className="flex items-center gap-2 text-sm text-white/60">
              <Sparkles className="size-4 text-brand" /> Đổi hoặc hủy gói bất kỳ lúc nào
            </p>
          </div>
          <PlanCards />
        </section>

        {/* faq */}
        <section aria-labelledby="faq" className="py-10" id="faq">
          <h2 id="faq" className="mb-5 text-[clamp(1.25rem,1.8vw,1.6rem)] font-bold">
            Câu hỏi thường gặp
          </h2>
          <Faq />
          <EmailCapture className="mt-12" />
        </section>

        <p className="flex items-center justify-center gap-2 pt-6 pb-2 text-sm text-white/50">
          <Users className="size-4" /> Một tài khoản, tối đa 5 hồ sơ cho cả gia đình.
        </p>
      </div>
      <SiteFooter className="max-w-[96rem] lg:px-[max(var(--gutter),8rem)]" />
    </div>
  );
}
