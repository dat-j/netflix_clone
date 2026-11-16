import type { Metadata } from "next";
import { MyListPage } from "@/components/browse/collection-pages";

export const metadata: Metadata = { title: "Danh sách của tôi" };

export default function Page() {
  return <MyListPage />;
}
