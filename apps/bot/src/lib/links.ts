/** URL builders for the Mini App (`/tg?to=<path>`) and the public website. */
export type AppPath =
  | "/browse" | "/browse/movies" | "/browse/series" | "/my-list" | "/account" | "/plans"
  | `/browse/genre/${string}` | `/title/${string}` | `/watch/${string}` | `/search?q=${string}`;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether the Mini App entry keeps `?episode=<uuid>` on `/watch/<titleId>`. packages/shared `sanitizeMiniAppPath`
 * currently returns only the pathname for every path except /search, so the query would be stripped and the episode
 * lost — episode buttons then open the title page (where the viewer picks the episode) instead. Flip this to true
 * once the sanitizer allows the query; test/links.test.ts cross-checks this flag against the real sanitizer.
 */
export const MINI_APP_EPISODE_DEEP_LINKS = true;

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
  /** Plays one episode in the Mini App when deep links survive the sanitizer, else opens the title page. */
  episode: (titleId: string, episodeId: string, slug: string): AppPath => {
    if (!MINI_APP_EPISODE_DEEP_LINKS) return paths.title(slug);
    if (!UUID_RE.test(episodeId)) throw new Error(`invalid episode id ${episodeId}`);
    return `${paths.watch(titleId)}?episode=${episodeId.toLowerCase()}` as AppPath;
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
