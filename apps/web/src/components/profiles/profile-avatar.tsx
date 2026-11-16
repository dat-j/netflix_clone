/* eslint-disable @next/next/no-img-element -- avatars are tiny SVGs, no optimisation needed */
import type { ProfileDto } from "@app/shared";
import { cn } from "@/lib/utils";

/** Avatar URLs may be absolute (API/CDN) or web-relative (/avatars/…); fall back to a key-derived local SVG. */
export function avatarSrc(p: Pick<ProfileDto, "avatarUrl" | "avatarKey">): string {
  if (p.avatarUrl) return p.avatarUrl;
  const n = /\d+/.exec(p.avatarKey)?.[0] ?? "1";
  return `/avatars/avatar-${n}.svg`;
}

export function ProfileAvatar({ profile, className }: { profile: Pick<ProfileDto, "avatarUrl" | "avatarKey" | "name">; className?: string }) {
  return <img src={avatarSrc(profile)} alt="" draggable={false} className={cn("aspect-square object-cover", className)} />;
}
