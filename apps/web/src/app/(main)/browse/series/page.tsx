import type { Metadata } from "next";
import { BrowseHome } from "@/components/browse/browse-home";

export const metadata: Metadata = { title: "Phim bộ" };

export default function SeriesPage() {
  return <BrowseHome type="SERIES" />;
}
