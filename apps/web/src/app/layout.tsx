import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { BRAND, SITE_URL } from "@/lib/brand";
import "./globals.css";

const sans = Be_Vietnam_Pro({
  variable: "--font-brand-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} – Xem phim, series trực tuyến`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: "vi_VN",
    title: `${BRAND.name} – ${BRAND.tagline}`,
    description: BRAND.description,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: BRAND.backgroundHex,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children, modal }: LayoutProps<"/"> & { modal: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} antialiased`}>
      <body className="min-h-dvh">
        <AppProviders>
          {children}
          {modal}
        </AppProviders>
      </body>
    </html>
  );
}
