"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "../controller";
import { qualityName } from "../lib/format";
import { RATES } from "../lib/prefs";
import { currentQualityLabel } from "../lib/state";
import { usePlayerStore, type MenuId } from "../store";
import { ControlButton } from "./control-button";
import { CheckIcon, QualityIcon, SpeedIcon, SubtitlesIcon } from "./icons";

/** Anchored popover on desktop, bottom sheet on touch. */
function MenuPanel({ id, title, children, className }: { id: Exclude<MenuId, null>; title: string; children: ReactNode; className?: string }) {
  const { setMenu, touch } = usePlayer();
  const open = usePlayerStore((s) => s.menu === id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the menu for keyboard users
    const first = ref.current?.querySelector<HTMLElement>("[aria-checked='true'], button");
    first?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return (
    <>
      {touch && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMenu(null)} aria-hidden />}
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        data-testid={`menu-${id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "z-50 text-white shadow-[0_12px_48px_rgb(0_0_0/0.65)]",
          touch
            ? "fixed inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-[#1f1f1f] px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            : "absolute right-0 bottom-full mb-4 max-h-[min(70vh,560px)] overflow-y-auto rounded-md bg-[#262626] py-3 ring-1 ring-white/10",
          className,
        )}
      >
        {touch && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/30" aria-hidden />}
        {children}
      </div>
    </>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return <h3 className="px-5 pb-2 text-lg font-bold tracking-tight text-white md:text-xl">{children}</h3>;
}

function MenuItem({ checked, onSelect, children, testId }: { checked: boolean; onSelect: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 py-2.5 pr-6 pl-4 text-left text-base transition-colors outline-none md:text-[17px]",
        "hover:bg-white/10 focus-visible:bg-white/15",
        checked ? "font-semibold text-white" : "text-white/70 hover:text-white",
      )}
    >
      <span className="grid size-5 place-items-center">{checked && <CheckIcon className="size-5" />}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function MenuTrigger({ id, label, children }: { id: Exclude<MenuId, null>; label: string; children: ReactNode }) {
  const { setMenu } = usePlayer();
  const open = usePlayerStore((s) => s.menu === id);
  return (
    <ControlButton
      label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid={`menu-trigger-${id}`}
      onClick={(e) => {
        e.stopPropagation();
        setMenu(open ? null : id);
      }}
    >
      {children}
    </ControlButton>
  );
}

// ───────── Âm thanh & phụ đề ─────────

export function AudioSubtitleMenu() {
  const { session, setSubtitle, setAudioTrack, setMenu } = usePlayer();
  const subtitleLang = usePlayerStore((s) => s.subtitleLang);
  const audioTracks = usePlayerStore((s) => s.audioTracks);
  const activeAudio = usePlayerStore((s) => s.activeAudioTrack);
  const subs = session?.subtitles ?? [];
  if (subs.length === 0 && audioTracks.length < 2) return null;

  return (
    <div className="relative">
      <MenuTrigger id="audio" label="Âm thanh và phụ đề">
        <SubtitlesIcon />
      </MenuTrigger>
      <MenuPanel id="audio" title="Âm thanh và phụ đề" className={audioTracks.length > 1 ? "md:flex md:min-w-[440px] md:gap-2" : "md:min-w-[240px]"}>
        {audioTracks.length > 1 && (
          <div className="min-w-[200px] flex-1">
            <MenuHeading>Âm thanh</MenuHeading>
            {audioTracks.map((t) => (
              <MenuItem key={t.id} checked={t.id === activeAudio} onSelect={() => { setAudioTrack(t.id); setMenu(null); }}>
                {t.name}
              </MenuItem>
            ))}
          </div>
        )}
        <div className="min-w-[200px] flex-1">
          <MenuHeading>Phụ đề</MenuHeading>
          <MenuItem checked={subtitleLang === null} onSelect={() => { setSubtitle(null); setMenu(null); }} testId="subtitle-off">
            Tắt
          </MenuItem>
          {subs.map((s) => (
            <MenuItem key={s.id} checked={subtitleLang === s.language} onSelect={() => { setSubtitle(s.language); setMenu(null); }}>
              {s.label}
            </MenuItem>
          ))}
        </div>
      </MenuPanel>
    </div>
  );
}

// ───────── Tốc độ phát ─────────

export function SpeedMenu() {
  const { setRate, touch } = usePlayer();
  const rate = usePlayerStore((s) => s.rate);
  return (
    <div className="relative">
      <MenuTrigger id="speed" label="Tốc độ phát">
        <SpeedIcon />
      </MenuTrigger>
      <MenuPanel id="speed" title="Tốc độ phát" className={touch ? undefined : "px-2 pt-4 pb-5"}>
        <MenuHeading>Tốc độ phát</MenuHeading>
        <div role="radiogroup" aria-label="Tốc độ phát" className="relative mt-4 px-6 pb-1">
          <div className="absolute top-[9px] right-[3.2rem] left-[3.2rem] h-[3px] bg-white/30" aria-hidden />
          <div className="relative flex justify-between gap-1 md:gap-5">
            {RATES.map((r) => {
              const selected = r === rate;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`rate-${r}`}
                  onClick={() => setRate(r)}
                  className={cn("group/rate flex flex-col items-center gap-3 rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-white", touch ? "min-w-[2.75rem]" : "min-w-[4.5rem]")}
                >
                  <span
                    className={cn(
                      "grid size-[21px] place-items-center rounded-full transition-transform",
                      selected ? "scale-125 bg-white/25" : "group-hover/rate:scale-110",
                    )}
                  >
                    <span className={cn("rounded-full bg-white", selected ? "size-3.5" : "size-2.5 bg-white/70")} />
                  </span>
                  <span className={cn("text-sm whitespace-nowrap md:text-base", selected ? "font-bold text-white" : "text-white/60")}>
                    {r === 1 && !touch ? "1x (Bình thường)" : `${r}x`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </MenuPanel>
    </div>
  );
}

// ───────── Chất lượng ─────────

export function QualityMenu() {
  const { setLevel, setMenu } = usePlayer();
  const levels = usePlayerStore((s) => s.levels);
  const selected = usePlayerStore((s) => s.selectedLevel);
  const activeLevel = usePlayerStore((s) => s.activeLevel);
  if (levels.length < 2) return null;
  const autoLabel = currentQualityLabel({ levels, selectedLevel: -1, activeLevel });
  return (
    <div className="relative">
      <MenuTrigger id="quality" label="Chất lượng video">
        <QualityIcon />
      </MenuTrigger>
      <MenuPanel id="quality" title="Chất lượng video" className="md:min-w-[260px]">
        <MenuHeading>Chất lượng</MenuHeading>
        <MenuItem checked={selected === -1} onSelect={() => { setLevel(-1); setMenu(null); }} testId="quality-auto">
          {autoLabel}
        </MenuItem>
        {levels.map((l) => (
          <MenuItem key={l.index} checked={selected === l.index} onSelect={() => { setLevel(l.index); setMenu(null); }} testId={`quality-${l.height}`}>
            {qualityName(l.height)}
          </MenuItem>
        ))}
      </MenuPanel>
    </div>
  );
}
