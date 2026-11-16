import type { UserDto } from "@app/shared";
import type { User } from "@app/db";

export function toUserDto(u: Pick<User, "id" | "email" | "role" | "emailVerifiedAt" | "createdAt">): UserDto {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}
