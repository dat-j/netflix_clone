export const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mkv", "mov", "qt", "avi", "webm", "ts", "m2ts", "mts", "wmv", "asf", "flv", "f4v",
  "mpg", "mpeg", "m2v", "mpe", "vob", "3gp", "3g2", "ogv", "mxf", "divx", "xvid", "rm", "rmvb", "y4m",
]);

/** True for keys that look like video files. Skips "directories", hidden/AppleDouble files and partial uploads. */
export function isVideoKey(key: string): boolean {
  if (!key || key.endsWith("/")) return false;
  const base = key.slice(key.lastIndexOf("/") + 1);
  if (!base || base.startsWith(".") || base.startsWith("._")) return false;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return VIDEO_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}
