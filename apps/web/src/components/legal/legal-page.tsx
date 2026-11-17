import Link from "next/link";
import { LogoLink } from "@/components/brand/logo";
import { SiteFooter } from "@/components/layout/site-footer";

export interface LegalSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export function LegalPage({ title, intro, updatedAt, sections }: {
  title: string;
  intro: string;
  updatedAt: string;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-header items-center justify-between border-b border-white/10 px-gutter">
        <LogoLink />
        <Link href="/browse" className="text-sm text-white/70 transition-colors hover:text-white">Về Lumio</Link>
      </header>
      <main className="mx-auto max-w-3xl px-gutter py-12 md:py-16">
        <p className="text-xs font-semibold tracking-[0.18em] text-brand uppercase">Trung tâm pháp lý</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-white/65">{intro}</p>
        <p className="mt-4 text-xs text-white/40">Cập nhật lần cuối: {updatedAt}</p>
        <div className="mt-10 space-y-9">
          {sections.map((section, index) => (
            <section key={section.title} className="border-t border-white/10 pt-6">
              <h2 className="text-lg font-semibold">{index + 1}. {section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-7 text-white/65">{paragraph}</p>
              ))}
              {section.bullets && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-white/65">
                  {section.bullets.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
        <p className="mt-12 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-white/45">
          Nếu có câu hỏi liên quan đến nội dung này, vui lòng liên hệ bộ phận hỗ trợ qua email được công bố trên trang Lumio.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
