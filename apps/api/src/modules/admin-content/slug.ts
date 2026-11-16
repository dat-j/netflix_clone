/** "Người Đẹp Đà Nẵng" → "nguoi-dep-da-nang" */
export function slugify(input: string, maxLen = 80): string {
  const s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return s || "item";
}

/** Slug duy nhất: thử `base`, `base-2`, `base-3`... với tập slug đã tồn tại có cùng tiền tố. */
export function pickUniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}-${i}`;
    if (!set.has(cand)) return cand;
  }
}
