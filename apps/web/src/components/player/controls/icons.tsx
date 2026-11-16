/** Bold, filled player glyphs (24×24). Original artwork, sized by the parent via `className`. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({ viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, focusable: false, ...p }) as P;

export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.5 3.9c0-.8.9-1.3 1.6-.9l12.2 7.6c.7.4.7 1.4 0 1.8L8.1 20c-.7.4-1.6-.1-1.6-.9z" />
  </svg>
);

export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="3.5" width="4.6" height="17" rx="1.1" />
    <rect x="14.4" y="3.5" width="4.6" height="17" rx="1.1" />
  </svg>
);

function SeekIcon({ forward, ...p }: P & { forward?: boolean }) {
  return (
    <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <g transform={forward ? "translate(24 0) scale(-1 1)" : undefined}>
        <path d="M4.6 9.2A8.3 8.3 0 1 1 3.8 13" />
        <path d="M4.2 4.4v4.9h4.9" />
      </g>
      <text x="12" y="15.6" textAnchor="middle" fontSize="7.4" fontWeight="800" fill="currentColor" stroke="none" fontFamily="inherit">
        10
      </text>
    </svg>
  );
}
export const Back10Icon = (p: P) => <SeekIcon {...p} />;
export const Forward10Icon = (p: P) => <SeekIcon forward {...p} />;

export function VolumeIcon({ level, ...p }: P & { level: 0 | 1 | 2 | 3 }) {
  return (
    <svg {...base(p)}>
      <path d="M3 9.3c0-.6.4-1 1-1h3.3L11.6 4c.6-.6 1.7-.2 1.7.7v14.6c0 .9-1.1 1.3-1.7.7l-4.3-4.3H4c-.6 0-1-.4-1-1z" />
      {level === 0 ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" fill="none" />
      ) : (
        <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" fill="none">
          <path d="M16 9.3a3.8 3.8 0 0 1 0 5.4" />
          {level >= 2 && <path d="M18.4 6.9a7.2 7.2 0 0 1 0 10.2" />}
          {level >= 3 && <path d="M20.8 4.5a10.6 10.6 0 0 1 0 15" />}
        </g>
      )}
    </svg>
  );
}

export const SubtitlesIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <path d="M3 5.5c0-.6.4-1 1-1h16c.6 0 1 .4 1 1v11c0 .6-.4 1-1 1h-8.5L7 21v-3.5H4c-.6 0-1-.4-1-1z" />
    <path d="M7 11.5h3M13 11.5h4M7 14.5h6" strokeLinecap="round" />
  </svg>
);

export const SpeedIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M3.6 17.5a9 9 0 1 1 16.8 0" />
    <path d="M12 13.2l4.2-4.2" />
    <circle cx="12" cy="13.5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const QualityIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M7 9.5v5M7 12h3.4M10.4 9.5v5M14 9.5v5h1.6a2.5 2.5 0 0 0 0-5z" strokeLinecap="round" />
  </svg>
);

export const FullscreenIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 9V3.5H9M15 3.5h5.5V9M20.5 15v5.5H15M9 20.5H3.5V15" />
  </svg>
);

export const ExitFullscreenIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3.5V9H3.5M20.5 9H15V3.5M15 20.5V15h5.5M3.5 15H9v5.5" />
  </svg>
);

export const PipIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const NextEpisodeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4.6c0-.8.9-1.3 1.6-.8l10 6.9c.6.4.6 1.3 0 1.7l-10 6.8c-.7.5-1.6 0-1.6-.8z" />
    <rect x="17.4" y="3.5" width="3" height="17" rx="1" />
  </svg>
);

export const BackArrowIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.5 12H4M10.5 5.5L4 12l6.5 6.5" />
  </svg>
);

export const ReplayIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.6 9.2A8.3 8.3 0 1 1 3.8 13" />
    <path d="M4.2 4.4v4.9h4.9" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);
