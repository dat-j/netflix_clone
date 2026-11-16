import type { Metadata } from "next";
import { BrowseHome } from "@/components/browse/browse-home";

export const metadata: Metadata = { title: "Phim lẻ" };

export default function MoviesPage() {
  return <BrowseHome type="MOVIE" />;
}
