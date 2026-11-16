import { UsersSection } from "@/components/admin/sections/users";

// Trang admin là SPA phía client sau cổng xác thực (/auth/me) — không cần xác thực điều hướng tức thì.
export const instant = false;

export default function Page() {
  return <UsersSection />;
}
