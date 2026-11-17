/** One-time bot profile setup (commands, menu button, descriptions). Every call is best-effort. */
import type { Api } from "grammy";
import { miniAppUrl } from "./lib/links.js";
import { errMessage, logger } from "./lib/log.js";

const log = logger("startup");

export const COMMANDS = [
  { command: "start", description: "Trang chủ BoxPhim" },
  { command: "search", description: "Tìm phim theo tên, diễn viên, thể loại" },
  { command: "moi", description: "Phim mới cập nhật" },
  { command: "hot", description: "Phim hot nhất tuần" },
  { command: "help", description: "Hướng dẫn & hỗ trợ" },
];

export const DESCRIPTION =
  "🎬 BoxPhim — kho phim lẻ, phim bộ chất lượng cao.\n\n" +
  "• Duyệt phim mới, phim hot, theo thể loại ngay trong Telegram\n" +
  "• Tìm phim nhanh, gõ không dấu cũng được\n" +
  "• Bấm ▶ Xem ngay để mở BoxPhim và xem phim\n\n" +
  "Bấm Bắt đầu để khám phá!";
export const SHORT_DESCRIPTION = "Xem phim lẻ, phim bộ chất lượng cao ngay trên Telegram. Phim mới mỗi ngày!";

export async function configureBot(api: Api, publicWebUrl: string) {
  const steps: [string, () => Promise<unknown>][] = [
    ["setMyCommands", () => api.setMyCommands(COMMANDS)],
    ["setMyCommands(vi)", () => api.setMyCommands(COMMANDS, { language_code: "vi" })],
    ["setChatMenuButton", () => api.setChatMenuButton({ menu_button: { type: "web_app", text: "BoxPhim", web_app: { url: miniAppUrl(publicWebUrl) } } })],
    ["setMyDescription", () => api.setMyDescription(DESCRIPTION)],
    ["setMyShortDescription", () => api.setMyShortDescription(SHORT_DESCRIPTION)],
  ];
  for (const [name, fn] of steps) {
    try {
      await fn();
      log.info(`${name} ok`);
    } catch (err) {
      log.warn(`${name} failed`, { err: errMessage(err) });
    }
  }
}
