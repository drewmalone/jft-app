import type { FormEvent } from 'react';
import { LockIcon } from './lock-icon';

type ShareFormProps = {
  text: string;
  disabled: boolean;
  error: string;
  onTextChange: (text: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
};

/** Keeps text entry accessible while its parent owns the draft and save operation. */
export function ShareForm({
  text,
  disabled,
  error,
  onTextChange,
  onSave
}: ShareFormProps) {
  return (
    <form onSubmit={onSave} className="mt-7">
      <label htmlFor="thoughts" className="sr-only">
        Your thoughts about today&apos;s reading
      </label>
      <textarea
        id="thoughts"
        aria-describedby={`share-help${error ? ' share-error' : ''}`}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Start wherever you are…"
        className="min-h-64 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5 font-serif text-xl leading-relaxed outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--navy)] focus:ring-1 focus:ring-[var(--navy)]"
      />
      <p
        id="share-help"
        className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[var(--muted)]"
      >
        <LockIcon /> Saved only in this browser. Your words stay on this device.
      </p>
      <button
        className="primary mt-7 w-full"
        disabled={disabled || !text.trim()}
        type="submit"
      >
        Save privately <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
