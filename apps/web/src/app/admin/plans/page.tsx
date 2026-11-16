import { PlansSection } from "@/components/admin/sections/plans";

// Trang admin là SPA phía client sau cổng xác thực (/auth/me) — không cần xác thực điều hướng tức thì.
export const instant = false;

export default function Page() {
  return <PlansSection />;
}
