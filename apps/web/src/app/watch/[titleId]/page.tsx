import type { Metadata } from "next";
import { Suspense } from "react";
import { Player } from "@/components/player/player";
import { PlayerShell } from "@/components/player/player-shell";

export const metadata: Metadata = { title: "Đang phát" };

export default function WatchPage({ params, searchParams }: PageProps<"/watch/[titleId]">) {
  return (
    <Suspense fallback={<PlayerShell />}>
      <WatchFromParams params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WatchFromParams({ params, searchParams }: Pick<PageProps<"/watch/[titleId]">, "params" | "searchParams">) {
  const { titleId } = await params;
  const sp = await searchParams;
  const episode = typeof sp.episode === "string" && sp.episode ? sp.episode : null;
  // Remount per title/episode so every piece of player state starts fresh
  return <Player key={`${titleId}:${episode ?? ""}`} titleId={titleId} episodeId={episode} />;
}
