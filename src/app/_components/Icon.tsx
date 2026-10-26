/** Inline SVG icons (24×24, current colour), so no glyph renders as an emoji on some platforms. */
const PATHS = {
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  stop: (
    <rect
      x="6.5"
      y="6.5"
      width="11"
      height="11"
      rx="1.5"
      fill="currentColor"
      stroke="none"
    />
  ),
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  restart: <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5M4 4v4.5h4.5" />,
  sliders: <path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-4",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
