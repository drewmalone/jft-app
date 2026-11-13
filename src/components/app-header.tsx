import Image from 'next/image';

type AppHeaderProps = {
  onHome: () => void;
  onNavigate: () => void;
  navigationLabel: string;
  disabled?: boolean;
};

/** Displays branding and the navigation action chosen by the current screen. */
export function AppHeader({
  onHome,
  onNavigate,
  navigationLabel,
  disabled = false
}: AppHeaderProps) {
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-[var(--line)] px-6 py-6 sm:px-10">
      <button
        disabled={disabled}
        className="brand flex items-center gap-3"
        onClick={onHome}
        aria-label="Doorknob, today's reflection"
      >
        <Image
          src="/doorknob-logo.svg"
          width={30}
          height={39}
          alt=""
          aria-hidden="true"
        />
        <span>Doorknob</span>
      </button>
      <button disabled={disabled} className="nav-link" onClick={onNavigate}>
        {navigationLabel} <span aria-hidden="true">→</span>
      </button>
    </header>
  );
}
