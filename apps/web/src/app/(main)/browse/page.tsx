import type { Metadata } from "next";
import { BrowseHome } from "@/components/browse/browse-home";

export const metadata: Metadata = { title: "Trang chủ" };

export default function BrowsePage() {
  return <BrowseHome />;
}
