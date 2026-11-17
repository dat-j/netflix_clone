/** URL builders for the Mini App (`/tg?to=<path>`) and the public website. */
export type AppPath =
  | "/browse" | "/browse/movies" | "/browse/series" | "/my-list" | "/account" | "/plans"
  | `/browse/genre/${string}` | `/title/${string}` | `/watch/${string}` | `/search?q=${string}`;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const paths = {
  browse: (): AppPath => "/browse",
  movies: (): AppPath => "/browse/movies",
  series: (): AppPath => "/browse/series",
  myList: (): AppPath => "/my-list",
  account: (): AppPath => "/account",
  plans: (): AppPath => "/plans",
  genre: (slug: string): AppPath => {
    if (!SLUG_RE.test(slug)) throw new Error(`invalid slug ${slug}`);
    return `/browse/genre/${slug}`;
  },
  title: (slug: string): AppPath => {
    if (!SLUG_RE.test(slug)) throw new Error(`invalid slug ${slug}`);
    return `/title/${slug}`;
  },
  watch: (titleId: string): AppPath => {
    if (!UUID_RE.test(titleId)) throw new Error(`invalid title id ${titleId}`);
    return `/watch/${titleId.toLowerCase()}`;
  },
  search: (q: string): AppPath => `/search?q=${encodeURIComponent(q.trim().slice(0, 100))}`,
};

function origin(publicWebUrl: string): string {
  return publicWebUrl.replace(/\/+$/, "");
}

/** `${PUBLIC_WEB_URL}/tg?to=<urlencoded path>` — the Mini App entry decodes `to` and navigates there. */
export function miniAppUrl(publicWebUrl: string, path?: AppPath): string {
  const base = `${origin(publicWebUrl)}/tg`;
  return path ? `${base}?to=${encodeURIComponent(path)}` : base;
}

/** Plain website URL (used where web_app buttons are not allowed, e.g. inline-mode results in other chats). */
export function websiteUrl(publicWebUrl: string, path: AppPath): string {
  return `${origin(publicWebUrl)}${path}`;
}
