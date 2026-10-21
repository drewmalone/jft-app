/** Describes link access without implying recipient restrictions. */
export function AppFooter() {
  return (
    <footer className="mt-8 text-center sm:mt-12">
      <div className="divider" />
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
        Anyone with a sharing link can view that share.
      </p>
    </footer>
  );
}
