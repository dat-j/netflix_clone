import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Câu hỏi thường gặp", href: "/#faq" },
  { label: "Trung tâm trợ giúp", href: `mailto:${BRAND.supportEmail}?subject=Yeu%20cau%20ho%20tro` },
  { label: "Tài khoản", href: "/account" },
  { label: "Gói dịch vụ", href: "/plans" },
  { label: "Trang chủ", href: "/" },
  { label: "Liên hệ với chúng tôi", href: `mailto:${BRAND.supportEmail}` },
] as const;

export function SiteFooter({ className, compact }: { className?: string; compact?: boolean }) {
  const links = compact ? LINKS.slice(0, 4) : LINKS;

  return (
    <footer
      className={cn(
        "mx-auto w-full max-w-[1000px] px-gutter pt-12 pb-10 text-[0.8125rem] text-[#808080] md:pt-16",
        className,
      )}
    >
      <div className="mb-7 flex flex-col gap-2">
        <p className="text-[0.95rem] text-[#b3b3b3]">
          Bạn cần hỗ trợ?{" "}
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="font-medium text-[#b3b3b3] underline underline-offset-2 transition-colors hover:text-white"
          >
            Liên hệ với chúng tôi
          </a>
        </p>
        <a
          href={`mailto:${BRAND.supportEmail}`}
          className="w-fit text-xs text-[#808080] transition-colors hover:text-white"
        >
          {BRAND.supportEmail}
        </a>
      </div>

      <nav aria-label="Liên kết chân trang">
        <ul className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 md:grid-cols-4 md:gap-x-8 md:gap-y-5">
          {links.map(({ label, href }) => (
            <li key={label}>
              {href.startsWith("mailto:") ? (
                <a
                  href={href}
                  className="inline-block leading-relaxed underline-offset-2 transition-colors hover:text-white hover:underline"
                >
                  {label}
                </a>
              ) : (
                <Link
                  href={href}
                  className="inline-block leading-relaxed underline-offset-2 transition-colors hover:text-white hover:underline"
                >
                  {label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-9 border-t border-white/10 pt-5">
        <p className="text-xs leading-relaxed text-[#666]">
          © 2026 {BRAND.name}. Nội dung và quyền sở hữu thuộc về các chủ sở hữu tương ứng.
        </p>
        <p className="mt-2 text-[0.7rem] tracking-wide text-[#555]">{BRAND.name} · {BRAND.country}</p>
      </div>
    </footer>
  );
}
