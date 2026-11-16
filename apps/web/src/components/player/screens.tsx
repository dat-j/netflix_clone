"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BackArrowIcon } from "./controls/icons";

export type ScreenKind =
  | "NO_SUBSCRIPTION"
  | "TOO_MANY_STREAMS"
  | "NOT_PLAYABLE"
  | "SESSION_ENDED"
  | "NETWORK"
  | "MEDIA"
  | "UNSUPPORTED"
  | "GENERIC";

interface Props {
  kind: ScreenKind;
  backdropUrl?: string | null;
  titleName?: string | null;
  detailMessage?: string | null;
  onRetry?: () => void;
  onBack: () => void;
  retrying?: boolean;
}

const BTN = "inline-flex h-12 items-center justify-center rounded-md px-7 text-base font-bold transition outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black md:h-[52px] md:text-lg";
const PRIMARY = `${BTN} bg-white text-black hover:bg-white/80`;
const BRAND = `${BTN} bg-[var(--brand,#e50914)] text-white hover:bg-[var(--brand-hover,#f6121d)]`;
const SECONDARY = `${BTN} bg-white/15 text-white hover:bg-white/25`;

/** Full-screen state shown instead of (or over) the video. */
export function PlayerScreen({ kind, backdropUrl, titleName, detailMessage, onRetry, onBack, retrying }: Props) {
  let code: string | null = null;
  let heading: string;
  let body: ReactNode;
  let actions: ReactNode;

  const retryBtn = onRetry && (
    <button type="button" onClick={onRetry} disabled={retrying} className={cn(PRIMARY, retrying && "opacity-60")} data-testid="screen-retry" autoFocus>
      {retrying ? "Đang thử lại…" : "Thử lại"}
    </button>
  );
  const backBtn = (
    <button type="button" onClick={onBack} className={SECONDARY}>
      Quay lại
    </button>
  );

  switch (kind) {
    case "NO_SUBSCRIPTION":
      heading = "Chọn gói để bắt đầu xem";
      body = (
        <>
          {titleName ? <>Để xem <strong className="text-white">{titleName}</strong>, bạn </> : "Bạn "}
          cần có gói thuê bao đang hoạt động. Xem phim không giới hạn, huỷ bất cứ lúc nào.
        </>
      );
      actions = (
        <>
          <Link href="/plans" className={BRAND} data-testid="upsell-plans" autoFocus>
            Xem các gói cước
          </Link>
          {backBtn}
        </>
      );
      break;
    case "TOO_MANY_STREAMS":
      code = "Mã lỗi: TOO_MANY_STREAMS";
      heading = "Đang có quá nhiều thiết bị cùng xem";
      body = (
        <>
          Tài khoản của bạn đang phát trên số thiết bị tối đa mà gói cước cho phép. Hãy dừng phát trên một thiết bị khác rồi thử lại, hoặc
          nâng cấp gói để xem trên nhiều thiết bị hơn.
        </>
      );
      actions = (
        <>
          {retryBtn}
          <Link href="/account" className={SECONDARY}>
            Quản lý thiết bị
          </Link>
          <Link href="/plans" className={SECONDARY}>
            Nâng cấp gói
          </Link>
        </>
      );
      break;
    case "NOT_PLAYABLE":
      code = "Mã lỗi: NOT_PLAYABLE";
      heading = "Nội dung này hiện chưa thể phát";
      body = <>Chúng tôi đang chuẩn bị video cho {titleName ? <strong className="text-white">{titleName}</strong> : "nội dung này"}. Vui lòng quay lại sau nhé.</>;
      actions = (
        <>
          <Link href="/browse" className={PRIMARY} autoFocus>
            Khám phá phim khác
          </Link>
          {backBtn}
        </>
      );
      break;
    case "SESSION_ENDED":
      code = "Mã lỗi: SESSION_ENDED";
      heading = "Phiên xem đã kết thúc";
      body = <>Tài khoản của bạn vừa bắt đầu phát trên một thiết bị khác nên phiên xem này đã dừng lại. Bạn có thể tiếp tục xem tại đây.</>;
      actions = (
        <>
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={retrying} className={PRIMARY} data-testid="screen-retry" autoFocus>
              {retrying ? "Đang kết nối…" : "Tiếp tục xem tại đây"}
            </button>
          )}
          {backBtn}
        </>
      );
      break;
    case "NETWORK":
      code = "Mã lỗi: NETWORK";
      heading = "Mất kết nối";
      body = <>Không thể tải video. Hãy kiểm tra kết nối Internet của bạn rồi thử lại.</>;
      actions = (
        <>
          {retryBtn}
          {backBtn}
        </>
      );
      break;
    case "UNSUPPORTED":
      code = "Mã lỗi: UNSUPPORTED";
      heading = "Trình duyệt chưa được hỗ trợ";
      body = <>Trình duyệt này không phát được video. Hãy cập nhật hoặc dùng Chrome, Edge, Firefox hay Safari phiên bản mới.</>;
      actions = backBtn;
      break;
    case "MEDIA":
    case "GENERIC":
    default:
      code = kind === "MEDIA" ? "Mã lỗi: MEDIA" : null;
      heading = "Rất tiếc, đã xảy ra sự cố";
      body = <>Chúng tôi gặp sự cố khi phát nội dung này. Vui lòng thử lại sau giây lát.</>;
      actions = (
        <>
          {retryBtn}
          {backBtn}
        </>
      );
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-black" data-testid={`player-screen-${kind}`} role="alert">
      {backdropUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- dimmed backdrop
        <img src={backdropUrl} alt="" className="absolute inset-0 size-full scale-105 object-cover opacity-25 blur-[2px]" />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.35),rgb(0_0_0/0.9))]" />
      <button
        type="button"
        onClick={onBack}
        aria-label="Quay lại"
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 grid size-12 place-items-center rounded-full text-white transition-transform hover:scale-110 md:top-5 md:left-6 md:size-14 [&>svg]:size-8 md:[&>svg]:size-10"
      >
        <BackArrowIcon />
      </button>
      <div className="relative w-full max-w-xl px-6 text-center motion-safe:animate-[fade-in_0.4s_ease-out]">
        <h1 className="text-2xl leading-tight font-bold tracking-tight text-white md:text-4xl">{heading}</h1>
        <p className="mt-4 text-base leading-relaxed text-white/75 md:text-lg">{body}</p>
        {detailMessage && <p className="mt-2 text-sm text-white/45">{detailMessage}</p>}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>
        {code && <p className="mt-8 text-xs tracking-wide text-white/40">{code}</p>}
      </div>
    </div>
  );
}
