import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const LINKS = [
  ["Câu hỏi thường gặp", "/#faq"],
  ["Trung tâm trợ giúp", "/#faq"],
  ["Tài khoản", "/account"],
  ["Gói dịch vụ", "/plans"],
  ["Điều khoản sử dụng", "/#"],
  ["Quyền riêng tư", "/#"],
  ["Tùy chọn cookie", "/#"],
  ["Liên hệ với chúng tôi", `mailto:${BRAND.supportEmail}`],
] as const;

export function SiteFooter({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <footer className={cn("mx-auto w-full max-w-[1000px] px-gutter pt-10 pb-12 text-[0.8125rem] text-[#808080]", className)}>
      <p className="mb-6">
        Bạn có câu hỏi? Liên hệ{" "}
        <a href={`tel:${BRAND.supportPhone.replace(/\s/g, "")}`} className="underline hover:text-white/80">
          {BRAND.supportPhone}
        </a>
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
        {(compact ? LINKS.slice(0, 4) : LINKS).map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="underline-offset-2 hover:underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8">
        © {2026} {BRAND.name} {BRAND.country}
      </p>
    </footer>
  );
}
