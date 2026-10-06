/** The Vanillate mark: a vanilla flower over two arrows (decorative). */
export function Logo() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M9 12h10.5l-3-3M23 20H12.5l3 3"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
