import { HoverPreviewLayer } from "@/components/browse/hover-preview";
import { AppHeader } from "@/components/layout/app-header";
import { SiteFooter } from "@/components/layout/site-footer";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader />
      <main id="main" className="main-content min-h-dvh">
        {children}
      </main>
      <SiteFooter compact className="tg:hidden" />
      <HoverPreviewLayer />
    </>
  );
}
