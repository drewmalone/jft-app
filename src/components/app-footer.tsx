/** Displays the app's reflection reminder and anonymous session explanation. */
export function AppFooter() {
  return (
    <footer className="mt-12 text-center">
      <div className="divider" />
      <p className="eyebrow">One day. One thought. One step.</p>
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
        Private history for this browser session. Anyone with a sharing link can
        read that share. Clearing cookies loses access to saved shares.
      </p>
    </footer>
  );
}
