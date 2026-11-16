import type { TitleCard } from "@app/shared";

/**
 * Remembers the last card data seen for a slug so the detail modal can paint
 * instantly (artwork, name, metadata) while the full TitleDetail loads.
 */
const cards = new Map<string, TitleCard>();

export function rememberCard(card: TitleCard) {
  cards.set(card.slug, card);
  cards.set(card.id, card);
}

export function recallCard(idOrSlug: string): TitleCard | undefined {
  return cards.get(idOrSlug);
}

export const titleHref = (card: Pick<TitleCard, "slug">) => `/title/${encodeURIComponent(card.slug)}`;
