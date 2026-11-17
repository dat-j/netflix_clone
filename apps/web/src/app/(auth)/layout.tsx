import { LogoLink } from "@/components/brand/logo";
import { PosterWall } from "@/components/landing/poster-wall";
import { SiteFooter } from "@/components/layout/site-footer";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-black sm:bg-transparent">
      <PosterWall intensity="auth" className="fixed max-sm:hidden" />
      <header className="relative z-10 px-gutter py-5 md:px-[max(var(--gutter),2rem)] md:py-6">
        <LogoLink />
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center sm:px-4 sm:pt-4 sm:pb-16">
        <div className="ui-enter-soft w-full bg-black px-6 pt-4 pb-10 sm:max-w-[450px] sm:rounded-xl sm:border sm:border-white/10 sm:bg-black/75 sm:px-[68px] sm:pt-12 sm:pb-12 sm:shadow-[0_24px_80px_rgba(0,0,0,.4)]">{children}</div>
      </main>
      <div className="relative z-10 border-t border-white/10 bg-black/75 max-sm:border-[#333]">
        <SiteFooter compact />
      </div>
    </div>
  );
}
