// Pictogrammes du design (grille 24 px, trait 1,8 px, currentColor) — repris de bundle.js.
// Chaque icône est une liste de formes SVG décrites en JSX.
import type { JSX } from 'react';

const P: Record<string, JSX.Element> = {
  home: <><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  gpu: <><rect x="2" y="6" width="20" height="11" rx="2" /><circle cx="9" cy="11.5" r="3" /><path d="M15 9.5h4M15 13.5h4M6 20h12" /></>,
  ram: <><rect x="2" y="7" width="20" height="9" rx="1.5" /><path d="M6 10.5v2M10 10.5v2M14 10.5v2M18 10.5v2M6 16v2M10 16v2M14 16v2M18 16v2" /></>,
  disk: <><rect x="3" y="12" width="18" height="8" rx="2" /><path d="M5 12l2.2-7h9.6L19 12" /><path d="M16.5 16h.01M13.5 16h.01" /></>,
  net: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  proc: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  bat: <><rect x="2" y="7" width="17" height="10" rx="2" /><path d="M22 11v2M6 10.5v3M10 10.5v3" /></>,
  fan: <><circle cx="12" cy="12" r="1.6" /><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z" /><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z" transform="rotate(120 12 12)" /><path d="M12 10.4C12 6 13 3 15.5 3S18 6 12 10.4z" transform="rotate(240 12 12)" /></>,
  boot: <><path d="M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8zM10 21h4" /></>,
  cog: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  dots: <><path d="M6 12h.01M12 12h.01M18 12h.01" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  caret: <><path d="M7 10l5 5 5-5" /></>,
  down: <><path d="M12 5v14M6 13l6 6 6-6" /></>,
  up: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  temp: <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  warn: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  min: <><path d="M6 12h12" /></>,
  max: <><rect x="6" y="6" width="12" height="12" rx="1" /></>,
  resize: <><path d="M20 10L10 20M20 16l-4 4" /></>,
  bolt: <><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></>,
  wifi: <><path d="M3 9a14 14 0 0 1 18 0M6 12.5a9 9 0 0 1 12 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5h.01" /></>,
  game: <><rect x="2" y="7" width="20" height="11" rx="5" /><path d="M7 10.5v4M5 12.5h4M16 11h.01M18.5 13.5h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></>,
  logo: <><path d="M2 13h4l2.5-7 4 13 3-9 1.5 3H22" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="sw-ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
